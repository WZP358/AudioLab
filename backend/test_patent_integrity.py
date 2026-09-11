import os
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.models import Algorithm
from app.schemas import ScoreCreate, StemScoreData
from app.services.separation_engine import MockSeparationEngine, build_separation_engine_from_env
from app.routers.blind_samples import _duration_seconds, _write_15_second_clip


class PatentIntegrityTests(unittest.TestCase):
    def valid_score(self, **overrides):
        data = {
            "task_id": 1,
            "algorithm": Algorithm.SCNET,
            "stem_name": "Vocals",
            "quality": 80,
            "interference": 75,
            "artifacts": 70,
            "overall_acceptability": 78,
            "segment_start": 1.0,
            "segment_end": 3.0,
            "issue_tags": ["伴奏残留"],
            "reliability": 90,
        }
        data.update(overrides)
        return ScoreCreate(**data)

    def test_valid_15_second_annotation_is_accepted(self):
        score = self.valid_score()
        self.assertEqual(score.segment_start, 1.0)
        self.assertEqual(score.segment_end, 3.0)

    def test_annotation_outside_15_seconds_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.valid_score(segment_end=15.1)

    def test_reversed_annotation_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.valid_score(segment_start=6.0, segment_end=2.0)

    def test_invalid_stem_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.valid_score(stem_name="Piano")

    def test_all_subjective_fields_are_range_checked(self):
        for field in ("quality", "interference", "artifacts", "overall_acceptability", "reliability"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.valid_score(**{field: 101})

    def test_custom_tags_are_normalized_and_deduplicated(self):
        score = self.valid_score(issue_tags=[" 自定义问题 ", "自定义问题"])
        self.assertEqual(score.issue_tags, ["自定义问题"])

    def test_mock_engine_is_disabled_by_default(self):
        with patch.dict(os.environ, {"SEPARATION_ENGINE": "mock"}, clear=False):
            os.environ.pop("ALLOW_TEST_ENGINES", None)
            with self.assertRaisesRegex(ValueError, "仅允许"):
                build_separation_engine_from_env()

    def test_mock_engine_requires_explicit_test_flag(self):
        with patch.dict(os.environ, {"SEPARATION_ENGINE": "mock", "ALLOW_TEST_ENGINES": "true"}, clear=False):
            self.assertIsInstance(build_separation_engine_from_env(), MockSeparationEngine)

    def test_real_audio_is_rendered_to_exact_15_second_wav(self):
        with tempfile.TemporaryDirectory(prefix="audiolab_blind_test_") as temp_dir:
            source = Path(temp_dir) / "source.wav"
            output = Path(temp_dir) / "clip.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=21", str(source)],
                check=True,
                timeout=30,
            )
            _write_15_second_clip(source, output, 3.0)
            self.assertTrue(output.exists())
            self.assertAlmostEqual(_duration_seconds(output), 15.0, places=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
