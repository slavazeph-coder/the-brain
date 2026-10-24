"""Names for separated objects from an object detector that runs on the worker, so a scene can be named without an API
key and without any frame leaving the worker.

EfficientDet-Lite2 (MediaPipe's float32 build, trained on COCO's 80 categories) looks at the frames object_names chooses
for each separated object. A detection names the object when its box overlaps the object's projected box, or when that
box lies mostly inside a detection not many times its size (sparse points often cover only part of an object). The same
category in more than one view, or one large clear match, makes the name medium or high confidence, and anything weaker
stays low (the compiler does not apply low names). COCO knows few room objects (sofa, chair, table, bed, television,
plant, appliances), so fixtures and most decor stay "Object N". Every name is an unreviewed suggestion, like a model's.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

PROVIDER = 'EfficientDet-Lite2 (COCO) on the worker'
RULES_VERSION = 'brainsnn-detector-names-v1'
MODEL = {'source': 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite',
         'sha256': 'ad2abbf2b4e10585e15176fd7b5ef03c28dda959ae26fc142549fdd1814db91d',
         'labels': 'COCO, 80 categories', 'license': 'not recorded in the file; the operator reviews it before enabling'}
MIN_SCORE = 0.3      # detections below this are ignored
MATCH_IOU = 0.3      # a detection names an object when its box and the object's projected box overlap this much,
MIN_INSIDE = 0.7     # or when this share of the object's box lies inside the detection
MAX_AREA_RATIO = 8   # and the detection is at most this many times the object's box (a sofa's box never names a cup)
STRONG_IOU = 0.5     # one view this clear (with STRONG_SCORE) is enough for medium confidence
STRONG_SCORE = 0.6
SECOND_SHARE = 0.5   # a second category with this share of the first's votes names a pair ("sofa and table")
# COCO categories that label something in a room, as a floor-plan name and one of object_names.CATEGORIES. People,
# animals, vehicles, food and sports gear never name a separated object.
LABELS = {'couch': ('sofa', 'furniture'), 'chair': ('chair', 'furniture'), 'bed': ('bed', 'furniture'),
          'dining table': ('table', 'furniture'), 'bench': ('bench', 'furniture'), 'toilet': ('toilet', 'fixture'),
          'sink': ('sink', 'fixture'), 'tv': ('television', 'electronics'), 'laptop': ('laptop', 'electronics'),
          'keyboard': ('keyboard', 'electronics'), 'refrigerator': ('refrigerator', 'appliance'), 'oven': ('oven', 'appliance'),
          'microwave': ('microwave', 'appliance'), 'toaster': ('toaster', 'appliance'), 'potted plant': ('potted plant', 'plant'),
          'vase': ('vase', 'decor'), 'clock': ('clock', 'decor'), 'book': ('books', 'storage'), 'suitcase': ('suitcase', 'storage'),
          'teddy bear': ('soft toy', 'decor'), 'bottle': ('bottle', 'other'), 'cup': ('cup', 'other'), 'bowl': ('bowl', 'other')}


def load(model_path: Path, max_results: int = 25):
    """detect(image_path) -> [(category, score, (x0, y0, x1, y1)), ...] in the image's pixels, for the pinned model only."""
    model_path = Path(model_path)
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if digest != MODEL['sha256']:
        raise ValueError(f'The detector model is not the pinned EfficientDet-Lite2 file (sha256 {digest[:12]}…).')
    import mediapipe as mp
    from mediapipe.tasks import python as tasks
    from mediapipe.tasks.python import vision
    detector = vision.ObjectDetector.create_from_options(vision.ObjectDetectorOptions(
        base_options=tasks.BaseOptions(model_asset_path=str(model_path)), score_threshold=MIN_SCORE, max_results=max_results))

    def detect(image_path):
        found = []
        for detection in detector.detect(mp.Image.create_from_file(str(image_path))).detections:
            top, box = detection.categories[0], detection.bounding_box
            found.append((top.category_name, float(top.score),
                          (box.origin_x, box.origin_y, box.origin_x + box.width, box.origin_y + box.height)))
        return found
    return detect


def iou(a, b):
    """Intersection over union of two (x0, y0, x1, y1) boxes."""
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def inside(a, b):
    """Share of box a inside box b, and b's area over a's."""
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    area_a, area_b = (a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])
    return (w * h / area_a if w > 0 and h > 0 else 0.0), area_b / area_a


def answer(items, detect):
    """Answers by item id in object_names.ask's format, from detections in each item's chosen views (item['picks'])."""
    cache, answers = {}, {}
    for item in items:
        votes, views_seen, strong = {}, {}, set()
        for pick in item['picks']:
            view = pick['view']
            if view['name'] not in cache:
                cache[view['name']] = detect(view['path'])
            best = {}
            for category, score, box in cache[view['name']]:
                if category not in LABELS or score < MIN_SCORE:
                    continue
                overlap, (share, ratio) = iou(pick['box'], box), inside(pick['box'], box)
                match = overlap if overlap >= MATCH_IOU else share / 2 if share >= MIN_INSIDE and ratio <= MAX_AREA_RATIO else 0.0
                if not match:
                    continue
                best[category] = max(best.get(category, 0.0), score * match)  # one vote per category per view
                if overlap >= STRONG_IOU and score >= STRONG_SCORE:
                    strong.add(category)
            for category, vote in best.items():
                votes[category] = votes.get(category, 0.0) + vote
                views_seen[category] = views_seen.get(category, 0) + 1
        if not votes:
            answers[item['id']] = {'label': 'unknown', 'category': 'unknown', 'confidence': 'low',
                                   'reason': 'no room-object detection overlapped it in its views'}
            continue
        ranked = sorted(votes, key=lambda c: -votes[c])
        top = ranked[0]
        label, category = LABELS[top]
        confidence = ('high' if top in strong and views_seen[top] >= 2 else
                      'medium' if top in strong or views_seen[top] >= 2 else 'low')
        if len(ranked) > 1 and votes[ranked[1]] >= SECOND_SHARE * votes[top] and LABELS[ranked[1]][0] != label:
            label = f'{label} and {LABELS[ranked[1]][0]}'
        answers[item['id']] = {'label': label, 'category': category, 'confidence': confidence,
                               'reason': f"'{top}' detected in {views_seen[top]} of {len(item['picks'])} views"}
    return answers, PROVIDER, None
