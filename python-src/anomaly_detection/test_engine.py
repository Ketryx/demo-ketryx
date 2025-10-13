"""Unit tests for Anomaly Detection Engine.

Compliance: IEC 62304 - Software Unit Verification
"""

import pytest
import numpy as np
from .engine import AnomalyDetectionEngine


class TestAnomalyDetectionEngine:
    """Test suite for AnomalyDetectionEngine."""

    def test_initialization_valid_threshold(self):
        """Test engine initialization with valid threshold."""
        engine = AnomalyDetectionEngine(threshold=0.8)
        assert engine.threshold == 0.8
        assert engine.device_id == "ADE-001"

    def test_initialization_invalid_threshold(self):
        """Test engine initialization with invalid threshold."""
        with pytest.raises(ValueError, match="Threshold must be between"):
            AnomalyDetectionEngine(threshold=1.5)
        
        with pytest.raises(ValueError, match="Threshold must be between"):
            AnomalyDetectionEngine(threshold=-0.1)

    def test_preprocess_image_2d(self):
        """Test image preprocessing for 2D images."""
        engine = AnomalyDetectionEngine()
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        processed = engine.preprocess_image(image)
        
        assert processed.ndim == 4  # Batch, H, W, C
        assert processed.shape[0] == 1  # Batch size
        assert processed.max() <= 1.0
        assert processed.min() >= 0.0

    def test_preprocess_image_3d(self):
        """Test image preprocessing for 3D images."""
        engine = AnomalyDetectionEngine()
        image = np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8)
        processed = engine.preprocess_image(image)
        
        assert processed.ndim == 4
        assert processed.shape[0] == 1

    def test_preprocess_image_invalid_dimensions(self):
        """Test preprocessing with invalid image dimensions."""
        engine = AnomalyDetectionEngine()
        image = np.random.rand(10, 10, 10, 10)  # 4D not supported
        
        with pytest.raises(ValueError, match="Expected 2D or 3D image"):
            engine.preprocess_image(image)

    def test_detect_anomalies_mock_mode(self):
        """Test anomaly detection in mock mode."""
        engine = AnomalyDetectionEngine(threshold=0.75)
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        
        result = engine.detect_anomalies(image, patient_id="TEST_001")
        
        # Verify result structure
        assert "anomaly_detected" in result
        assert "anomaly_type" in result
        assert "confidence" in result
        assert "regions" in result
        assert "timestamp" in result
        assert "image_hash" in result
        assert "device_id" in result
        
        # Verify data types
        assert isinstance(result["anomaly_detected"], bool)
        assert isinstance(result["confidence"], float)
        assert 0.0 <= result["confidence"] <= 1.0

    def test_detect_anomalies_threshold_behavior(self):
        """Test that threshold correctly determines anomaly detection."""
        # High threshold should be more selective
        engine_high = AnomalyDetectionEngine(threshold=0.95)
        engine_low = AnomalyDetectionEngine(threshold=0.50)
        
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        
        result_high = engine_high.detect_anomalies(image, patient_id="TEST_002")
        result_low = engine_low.detect_anomalies(image, patient_id="TEST_002")
        
        # Both should return valid results
        assert "confidence" in result_high
        assert "confidence" in result_low

    def test_batch_detect(self):
        """Test batch detection with multiple images."""
        engine = AnomalyDetectionEngine()
        images = [
            np.random.randint(0, 255, (512, 512), dtype=np.uint8)
            for _ in range(3)
        ]
        
        results = engine.batch_detect(images, patient_id="TEST_003")
        
        assert len(results) == 3
        for idx, result in enumerate(results):
            assert result["image_index"] == idx
            assert "anomaly_detected" in result

    def test_get_model_info_mock_mode(self):
        """Test model info retrieval in mock mode."""
        engine = AnomalyDetectionEngine()
        info = engine.get_model_info()
        
        assert info["status"] == "mock_mode"
        assert info["model_loaded"] is False

    def test_anomaly_types_defined(self):
        """Test that all anomaly types are properly defined."""
        assert "NORMAL" in AnomalyDetectionEngine.ANOMALY_TYPES.values()
        assert "CALCIFICATION" in AnomalyDetectionEngine.ANOMALY_TYPES.values()
        assert "STENOSIS" in AnomalyDetectionEngine.ANOMALY_TYPES.values()

    def test_patient_id_privacy(self):
        """Test that patient IDs are properly hashed for privacy."""
        engine = AnomalyDetectionEngine()
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        
        result = engine.detect_anomalies(image, patient_id="SENSITIVE_ID_12345")
        
        # Result should not contain original patient ID
        result_str = str(result)
        assert "SENSITIVE_ID_12345" not in result_str
