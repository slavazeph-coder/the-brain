"""Names for separated objects from an open-vocabulary detector on the worker: the operator (or the request) says what
to look for, in words, and OWLv2 finds those things in the frames object_names chooses for each object.

Why: the COCO detector (detector_names.py) knows 80 everyday categories, so a golf cart, a pallet rack, a tire stack
or a fire extinguisher stays "Object N". OWLv2 (Google, Apache-2.0) matches text prompts to image regions, so the
vocabulary is a list of plain phrases per site: a showroom, a warehouse, a clinic. Votes, confidence and the
"unreviewed suggestion" status follow detector_names exactly; only the source of the detections differs.

Same contract as detector_names: load() -> detect(image_path) -> [(category, score, (x0, y0, x1, y1))]; answer(items,
detect) -> (answers by item id, provider, None). The model is loaded from a local directory only (a pinned snapshot the
operator installed); nothing is downloaded during a job and no frame leaves the worker.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

PROVIDER = 'OWLv2 open-vocabulary detector on the worker'
RULES_VERSION = 'brainsnn-open-vocab-names-v1'
MODEL = {'repo': 'google/owlv2-base-patch16-ensemble', 'license': 'Apache-2.0',
         'note': 'load from a local snapshot directory; the worker records the directory digest, never downloads'}
MIN_SCORE = 0.2      # OWLv2 scores are lower than closed-set detectors; 0.2 is the usual operating point
MATCH_IOU = 0.3
MIN_INSIDE = 0.7
MAX_AREA_RATIO = 8
STRONG_IOU = 0.5
STRONG_SCORE = 0.35
SECOND_SHARE = 0.5
MAX_TERMS = 40
# A default vocabulary for rooms and light-industrial spaces. Each term: prompt -> (label, category); categories are
# object_names.CATEGORIES so IFC classes and the viewer keep working. Operators extend or replace it per site.
DEFAULT_VOCABULARY = [
    ('golf cart', 'golf cart', 'vehicle'), ('forklift', 'forklift', 'vehicle'), ('pallet jack', 'pallet jack', 'vehicle'),
    ('car', 'car', 'vehicle'), ('motorcycle', 'motorcycle', 'vehicle'), ('bicycle', 'bicycle', 'vehicle'),
    ('stack of tires', 'tire stack', 'storage'), ('tire', 'tire', 'other'), ('wooden pallet', 'pallet', 'storage'),
    ('pallet rack', 'pallet rack', 'storage'), ('shelving unit', 'shelving', 'storage'), ('cardboard box', 'box', 'storage'),
    ('sofa', 'sofa', 'furniture'), ('chair', 'chair', 'furniture'), ('office chair', 'office chair', 'furniture'),
    ('table', 'table', 'furniture'), ('desk', 'desk', 'furniture'), ('bed', 'bed', 'furniture'), ('cabinet', 'cabinet', 'furniture'),
    ('counter', 'counter', 'furniture'), ('display stand', 'display stand', 'furniture'),
    ('television', 'television', 'electronics'), ('computer monitor', 'monitor', 'electronics'),
    ('refrigerator', 'refrigerator', 'appliance'), ('washing machine', 'washing machine', 'appliance'),
    ('fire extinguisher', 'fire extinguisher', 'fixture'), ('toilet', 'toilet', 'fixture'), ('sink', 'sink', 'fixture'),
    ('radiator', 'radiator', 'fixture'), ('potted plant', 'potted plant', 'plant'), ('trash can', 'bin', 'other'),
    ('ladder', 'ladder', 'other'), ('traffic cone', 'cone', 'other'), ('mannequin', 'mannequin', 'other'),
]
CATEGORIES = {'furniture', 'fixture', 'electronics', 'appliance', 'plant', 'decor', 'storage', 'vehicle', 'other'}


def parse_vocabulary(value):
    """A vocabulary from a request or config: a list of strings ("golf cart") or of {prompt, label, category} objects.
    Returns {prompt: (label, category)}; rejects empty, over-long or over-many terms rather than guessing."""
    if value is None:
        return {p: (l, c) for p, l, c in DEFAULT_VOCABULARY}
    if not isinstance(value, list) or not value or len(value) > MAX_TERMS:
        raise ValueError(f'A vocabulary is a list of 1 to {MAX_TERMS} terms.')
    terms = {}
    for entry in value:
        if isinstance(entry, str):
            prompt, label, category = entry, entry, 'other'
        elif isinstance(entry, dict):
            prompt, label, category = entry.get('prompt'), entry.get('label') or entry.get('prompt'), entry.get('category', 'other')
        else:
            raise ValueError('Each vocabulary term is a string or an object with prompt, label and category.')
        for text in (prompt, label):
            if not isinstance(text, str) or not 0 < len(text.strip()) <= 60:
                raise ValueError('Vocabulary prompts and labels are 1 to 60 characters.')
        if category not in CATEGORIES:
            raise ValueError(f'Unknown category {category!r}; one of {sorted(CATEGORIES)}.')
        prompt = prompt.strip().lower()
        if prompt in ('unknown', 'object'):
            raise ValueError('"unknown" and "object" are reserved names.')
        terms[prompt] = (label.strip(), category)
    return terms


def snapshot_digest(model_dir: Path):
    """sha256 over the sorted names and sizes of the files in a local model snapshot: enough to say which snapshot ran
    without hashing gigabytes on every job."""
    model_dir = Path(model_dir)
    h = hashlib.sha256()
    for path in sorted(p for p in model_dir.rglob('*') if p.is_file()):
        h.update(f'{path.relative_to(model_dir)}:{path.stat().st_size}\n'.encode())
    return h.hexdigest()


def load(model_dir: Path, vocabulary=None, min_score: float = MIN_SCORE, device: str | None = None):
    """detect(image_path) -> [(prompt, score, (x0, y0, x1, y1))] in the image's pixels, for the local snapshot only.
    detect.vocabulary holds {prompt: (label, category)}; detect.model the snapshot's identity."""
    model_dir = Path(model_dir)
    if not (model_dir / 'config.json').is_file():
        raise ValueError(f'{model_dir} is not a local OWLv2 snapshot (no config.json). The worker never downloads models.')
    config = json.loads((model_dir / 'config.json').read_text())
    if 'owlv2' not in str(config.get('model_type', '')).lower():
        raise ValueError(f'{model_dir} is not an OWLv2 model (model_type {config.get("model_type")!r}).')
    terms = parse_vocabulary(vocabulary)
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor
    processor = Owlv2Processor.from_pretrained(str(model_dir), local_files_only=True)
    model = Owlv2ForObjectDetection.from_pretrained(str(model_dir), local_files_only=True).eval()
    device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
    model.to(device)
    prompts = list(terms)

    def detect(image_path):
        from PIL import Image
        with Image.open(image_path) as source:
            image = source.convert('RGB')
        w, h = image.size
        inputs = processor(text=[prompts], images=image, return_tensors='pt').to(device)
        with torch.no_grad():
            out = model(**inputs)
        side = max(w, h)   # OWLv2 pads the image to a square before resizing; boxes come back in that square
        results = processor.post_process_grounded_object_detection(out, threshold=min_score, target_sizes=torch.tensor([[side, side]]), text_labels=[prompts])[0]
        found = []
        for score, label, box in zip(results['scores'].tolist(), results['text_labels'], results['boxes'].tolist()):
            x0, y0, x1, y1 = (max(0.0, min(float(v), float(side))) for v in box)
            x0, x1, y0, y1 = min(x0, w), min(x1, w), min(y0, h), min(y1, h)
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue
            found.append((label, float(score), (x0, y0, x1, y1)))
        return found
    detect.vocabulary = terms
    detect.model = {**MODEL, 'path': str(model_dir), 'snapshot_digest': snapshot_digest(model_dir), 'min_score': min_score, 'device': device}
    return detect


def iou(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def inside(a, b):
    """(share of a inside b, area of b over area of a)."""
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    area_a = (a[2] - a[0]) * (a[3] - a[1]); area_b = (b[2] - b[0]) * (b[3] - b[1])
    return (inter / area_a if area_a > 0 else 0.0), (area_b / area_a if area_a > 0 else float('inf'))


def answer(items, detect):
    """Answers by item id in object_names.ask's format: the same vote, overlap and confidence rules as detector_names,
    over the detector's own vocabulary."""
    terms = getattr(detect, 'vocabulary', None) or parse_vocabulary(None)
    cache, answers = {}, {}
    for item in items:
        votes, views_seen, strong = {}, {}, set()
        for pick in item['picks']:
            view = pick['view']
            key = (view.get('frame_id'), str(view['path']), view.get('image_sha256'))
            if view.get('image_sha256'):
                try:
                    from .object_names import view_image_bytes
                except ImportError:
                    from object_names import view_image_bytes
                view_image_bytes(view)
            if key not in cache:
                cache[key] = detect(view['path'])
                if view.get('image_sha256'):
                    view_image_bytes(view)
            best = {}
            for prompt, score, box in cache[key]:
                if prompt not in terms or score < MIN_SCORE:
                    continue
                overlap, (share, ratio) = iou(pick['box'], box), inside(pick['box'], box)
                match = overlap if overlap >= MATCH_IOU else share / 2 if share >= MIN_INSIDE and ratio <= MAX_AREA_RATIO else 0.0
                if not match:
                    continue
                best[prompt] = max(best.get(prompt, 0.0), score * match)
                if overlap >= STRONG_IOU and score >= STRONG_SCORE:
                    strong.add(prompt)
            for prompt, vote in best.items():
                votes[prompt] = votes.get(prompt, 0.0) + vote
                views_seen[prompt] = views_seen.get(prompt, 0) + 1
        if not votes:
            answers[item['id']] = {'label': 'unknown', 'category': 'unknown', 'confidence': 'low',
                                   'reason': 'no vocabulary term was detected over it in its views'}
            continue
        ranked = sorted(votes, key=lambda p: -votes[p])
        top = ranked[0]
        label, category = terms[top]
        confidence = ('high' if top in strong and views_seen[top] >= 2 else
                      'medium' if top in strong or views_seen[top] >= 2 else 'low')
        if len(ranked) > 1 and votes[ranked[1]] >= SECOND_SHARE * votes[top] and terms[ranked[1]][0] != label:
            label = f'{label} and {terms[ranked[1]][0]}'
        answers[item['id']] = {'label': label, 'category': category, 'confidence': confidence,
                               'reason': f"'{top}' detected in {views_seen[top]} of {len(item['picks'])} views"}
    return answers, PROVIDER, None
