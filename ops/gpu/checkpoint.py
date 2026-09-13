"""Small atomic JSON checkpoints for job cursors; model weights need job-native saves."""
import json
import os
from pathlib import Path
import tempfile


def save_json(path, value):
    """Replace a checkpoint only after content is flushed; readers see old or new."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, allow_nan=False, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_json(path, default=None):
    try:
        with open(path) as stream:
            return json.load(stream)
    except FileNotFoundError:
        return default
