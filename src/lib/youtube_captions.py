import json
import sys

from youtube_transcript_api import (
    AgeRestricted,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)


def pick(listing, languages):
    for finder in (
        listing.find_manually_created_transcript,
        listing.find_generated_transcript,
        listing.find_transcript,
    ):
        try:
            return finder(languages)
        except Exception:
            continue
    for transcript in listing:
        return transcript
    return None


def main():
    video_id = sys.argv[1]
    languages = [item for item in sys.argv[2].split(",") if item]
    api = YouTubeTranscriptApi()
    try:
        listing = api.list(video_id)
    except (TranscriptsDisabled, NoTranscriptFound):
        sys.stderr.write("NO_CAPTIONS\n")
        return 2
    except AgeRestricted:
        sys.stderr.write("AGE_RESTRICTED\n")
        return 3
    except VideoUnavailable:
        sys.stderr.write("UNAVAILABLE\n")
        return 4

    chosen = pick(listing, languages)
    if chosen is None:
        sys.stderr.write("NO_CAPTIONS\n")
        return 2
    fetched = chosen.fetch()
    payload = []
    for snippet in fetched:
        text = (snippet.text or "").strip()
        if not text:
            continue
        start = float(snippet.start or 0)
        duration = float(snippet.duration or 0)
        payload.append({"start": start, "end": start + duration, "text": text})
    json.dump(payload, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AgeRestricted:
        sys.stderr.write("AGE_RESTRICTED\n")
        raise SystemExit(3)
    except VideoUnavailable:
        sys.stderr.write("UNAVAILABLE\n")
        raise SystemExit(4)
    except (TranscriptsDisabled, NoTranscriptFound):
        sys.stderr.write("NO_CAPTIONS\n")
        raise SystemExit(2)
