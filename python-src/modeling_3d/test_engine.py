"""Unit tests for 3D Modeling Engine.

Compliance: IEC 62304 - Software Unit Verification
"""

import pytest
import numpy as np
from .engine import Modeling3DEngine


class TestModeling3DEngine:
    """Test suite for Modeling3DEngine."""

    def test_initialization_valid(self):
        """Test engine initialization with valid parameters."""
        engine = Modeling3DEngine(voxel_size=(0.5, 0.5, 0.5), smoothing_iterations=20)
        assert engine.voxel_size == (0.5, 0.5, 0.5)
        assert engine.smoothing_iterations == 20

    def test_initialization_invalid_voxel_size(self):
        """Test engine initialization with invalid voxel size."""
        with pytest.raises(ValueError, match="Voxel size must be positive"):
            Modeling3DEngine(voxel_size=(0.5, -0.1, 0.5))

    def test_initialization_invalid_smoothing(self):
        """Test engine initialization with invalid smoothing iterations."""
        with pytest.raises(ValueError, match="Smoothing iterations must be 0-100"):
            Modeling3DEngine(smoothing_iterations=150)

    def test_reconstruct_volume_success(self):
        """Test successful volume reconstruction from slices."""
        engine = Modeling3DEngine()
        slices = [np.random.randint(0, 255, (512, 512), dtype=np.uint8) for _ in range(50)]
        
        volume = engine.reconstruct_volume(slices, slice_spacing=1.0)
        
        assert volume.shape == (50, 512, 512)
        assert volume.dtype == np.uint8

    def test_reconstruct_volume_empty_slices(self):
        """Test volume reconstruction with empty slice list."""
        engine = Modeling3DEngine()
        
        with pytest.raises(ValueError, match="CT slices list is empty"):
            engine.reconstruct_volume([], slice_spacing=1.0)

    def test_reconstruct_volume_inconsistent_dimensions(self):
        """Test volume reconstruction with inconsistent slice dimensions."""
        engine = Modeling3DEngine()
        slices = [
            np.random.rand(512, 512),
            np.random.rand(256, 256),  # Different size
        ]
        
        with pytest.raises(ValueError, match="shape"):
            engine.reconstruct_volume(slices)

    def test_extract_surface(self):
        """Test surface mesh extraction from volume."""
        engine = Modeling3DEngine()
        volume = np.random.randint(0, 255, (50, 512, 512), dtype=np.uint8)
        
        mesh_data = engine.extract_surface(volume, threshold=128.0)
        
        assert "vertices" in mesh_data
        assert "faces" in mesh_data
        assert "normals" in mesh_data
        assert "metadata" in mesh_data
        
        assert mesh_data["vertices"].shape[1] == 3
        assert mesh_data["faces"].shape[1] == 3
        assert mesh_data["normals"].shape[1] == 3

    def test_generate_3d_model_complete(self):
        """Test complete 3D model generation pipeline."""
        engine = Modeling3DEngine()
        slices = [np.random.randint(0, 255, (512, 512), dtype=np.uint8) for _ in range(50)]
        
        result = engine.generate_3d_model(
            slices,
            patient_id="TEST_PATIENT_001",
            slice_spacing=1.0,
            threshold=128.0
        )
        
        # Verify result structure
        assert "mesh" in result
        assert "volume_shape" in result
        assert "volume_hash" in result
        assert "patient_hash" in result
        assert "processing_params" in result
        assert "timestamp" in result
        assert "device_id" in result
        
        # Verify volume shape
        assert result["volume_shape"] == (50, 512, 512)
        
        # Verify processing params
        params = result["processing_params"]
        assert params["threshold"] == 128.0
        assert params["slice_spacing"] == 1.0

    def test_export_model_stl(self):
        """Test model export in STL format."""
        engine = Modeling3DEngine()
        volume = np.random.randint(0, 255, (50, 512, 512), dtype=np.uint8)
        mesh_data = engine.extract_surface(volume)
        
        export_data = engine.export_model(mesh_data, format="stl")
        
        assert isinstance(export_data, bytes)
        assert len(export_data) > 0

    def test_export_model_unsupported_format(self):
        """Test export with unsupported format."""
        engine = Modeling3DEngine()
        volume = np.random.randint(0, 255, (50, 512, 512), dtype=np.uint8)
        mesh_data = engine.extract_surface(volume)
        
        with pytest.raises(ValueError, match="Format must be one of"):
            engine.export_model(mesh_data, format="xyz")

    def test_get_engine_info(self):
        """Test engine info retrieval."""
        engine = Modeling3DEngine(voxel_size=(0.6, 0.6, 0.8))
        info = engine.get_engine_info()
        
        assert info["voxel_size"] == (0.6, 0.6, 0.8)
        assert "supported_formats" in info
        assert "stl" in info["supported_formats"]

    def test_patient_id_privacy(self):
        """Test that patient IDs are properly hashed for privacy."""
        engine = Modeling3DEngine()
        slices = [np.random.randint(0, 255, (512, 512), dtype=np.uint8) for _ in range(10)]
        
        result = engine.generate_3d_model(slices, patient_id="SENSITIVE_PATIENT_ID")
        
        # Result should not contain original patient ID
        result_str = str(result)
        assert "SENSITIVE_PATIENT_ID" not in result_str
        assert "patient_hash" in result
