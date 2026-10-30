"""Bounded retries for Windows sharing/access-denied races during replacement."""

import os
import time


def replace_file(source, destination):
    """Replace without deleting the destination; permanent failures still raise.

    A scanner or viewer may briefly hold a closed candidate. Only Windows
    errors 5/32/33 receive up to four retries (0.75 seconds total backoff).
    This never changes permissions, kills an owner, or truncates the old file.
    """
    for attempt in range(5):
        try:
            os.replace(source, destination)
            return attempt
        except PermissionError as exc:
            if getattr(exc, "winerror", None) not in (5, 32, 33) or attempt == 4:
                raise
            time.sleep(0.05 * 2**attempt)
