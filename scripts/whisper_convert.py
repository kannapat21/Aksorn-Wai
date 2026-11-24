#!/usr/bin/env python3
"""
แปลงโมเดล Whisper รูปแบบ Hugging Face (transformers, ไฟล์ .safetensors) ให้ใช้กับ mlx-whisper บน Mac ได้
ใช้กับโมเดลภาษาไทยที่เทรนต่อจาก Whisper เช่น typhoon-ai/typhoon-whisper-turbo, biodatlab/whisper-th-medium-combined

  python scripts/whisper_convert.py <hf-repo-or-folder> <out-folder> [--q8|--q4]

ไม่ต้องใช้ torch: อ่าน safetensors ด้วย mlx โดยตรง
"""
import argparse
import json
import sys
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten, tree_unflatten

RENAME = [
    ("model.", ""),
    (".layers.", ".blocks."),
    (".self_attn_layer_norm.", ".attn_ln."),
    (".encoder_attn_layer_norm.", ".cross_attn_ln."),
    (".final_layer_norm.", ".mlp_ln."),
    (".self_attn.q_proj.", ".attn.query."),
    (".self_attn.k_proj.", ".attn.key."),
    (".self_attn.v_proj.", ".attn.value."),
    (".self_attn.out_proj.", ".attn.out."),
    (".encoder_attn.q_proj.", ".cross_attn.query."),
    (".encoder_attn.k_proj.", ".cross_attn.key."),
    (".encoder_attn.v_proj.", ".cross_attn.value."),
    (".encoder_attn.out_proj.", ".cross_attn.out."),
    (".fc1.", ".mlp1."),
    (".fc2.", ".mlp2."),
    ("encoder.layer_norm.", "encoder.ln_post."),
    ("decoder.layer_norm.", "decoder.ln."),
    ("decoder.embed_tokens.", "decoder.token_embedding."),
]


def hf_key(k):
    if k.startswith("proj_out") or k == "model.encoder.embed_positions.weight":
        return None  # proj_out ผูกกับ token_embedding / encoder ใช้ sinusoid ที่คำนวณเอง
    if k == "model.decoder.embed_positions.weight":
        return "decoder.positional_embedding"
    for a, b in RENAME:
        k = k.replace(a, b)
    return k


def dims_from(cfg):
    return {
        "n_mels": cfg["num_mel_bins"],
        "n_audio_ctx": cfg["max_source_positions"],
        "n_audio_state": cfg["d_model"],
        "n_audio_head": cfg["encoder_attention_heads"],
        "n_audio_layer": cfg["encoder_layers"],
        "n_vocab": cfg["vocab_size"],
        "n_text_ctx": cfg["max_target_positions"],
        "n_text_state": cfg["d_model"],
        "n_text_head": cfg["decoder_attention_heads"],
        "n_text_layer": cfg["decoder_layers"],
    }


def resolve(src):
    p = Path(src)
    if p.exists():
        return p
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(repo_id=src, allow_patterns=["config.json", "*.safetensors", "*.safetensors.index.json"]))


def convert(src, out, bits=None, dtype=mx.float16):
    from mlx_whisper import whisper
    path = resolve(src)
    cfg = json.loads((path / "config.json").read_text())
    files = sorted(path.glob("*.safetensors"))
    if not files:
        raise SystemExit("ไม่พบไฟล์ .safetensors ในโมเดลนี้ (ต้องใช้ torch แปลง ไม่รองรับ)")
    weights = {}
    for f in files:
        for k, v in mx.load(str(f)).items():
            nk = hf_key(k)
            if nk is None:
                continue
            if nk.endswith("conv1.weight") or nk.endswith("conv2.weight"):
                v = v.transpose(0, 2, 1)  # torch (out,in,k) → mlx (out,k,in)
            weights[nk] = v.astype(dtype)
    dims = dims_from(cfg)
    model = whisper.Whisper(whisper.ModelDimensions(**dims), dtype)
    want = {k: v for k, v in tree_flatten(model.parameters()) if k != 'alignment_heads'}
    missing = [k for k in want if k not in weights]
    extra = [k for k in weights if k not in want]
    bad = [k for k in want if k in weights and tuple(want[k].shape) != tuple(weights[k].shape)]
    if missing or extra or bad:
        raise SystemExit("แปลงไม่ครบ missing=%s extra=%s shape=%s" % (missing[:5], extra[:5], bad[:5]))
    model.update(tree_unflatten(list(weights.items())))
    conf = dict(dims, model_type="whisper")
    if bits:
        nn.quantize(model, group_size=64, bits=bits, class_predicate=lambda p, m: isinstance(m, (nn.Linear, nn.Embedding)) and m.weight.shape[-1] % 64 == 0)
        conf["quantization"] = {"group_size": 64, "bits": bits}
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(out / "weights.safetensors"), {k: v for k, v in tree_flatten(model.parameters()) if k != "alignment_heads"})
    (out / "config.json").write_text(json.dumps(conf, indent=2))
    size = (out / "weights.safetensors").stat().st_size
    print(json.dumps({"ok": True, "out": str(out), "mb": round(size / 1e6), "dims": dims, "bits": bits or 16}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--q8", action="store_true")
    g.add_argument("--q4", action="store_true")
    a = ap.parse_args()
    convert(a.src, a.out, 8 if a.q8 else 4 if a.q4 else None)
    sys.exit(0)
