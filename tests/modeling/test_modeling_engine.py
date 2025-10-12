```python
import os
import time
import psutil
import pytest
import numpy as np

from modeling.engine import (
    ModelingEngine,
    ModelingEngineError,
    DICOMProcessingError,
    SegmentationError,
    MeshGenerationError,
    ExportFormatError,
)

TEST_DATA_DIR = os.path.join(os.path.dirname(__file__), "test_data")
VALID_CT_DIR = os.path.join(TEST_DATA_DIR, "valid_ct")
POOR_QUALITY_CT_DIR = os.path.join(TEST_DATA_DIR, "poor_quality_ct")
ARTIFACT_CT_DIR = os.path.join(TEST_DATA_DIR, "artifact_ct")

EXPORT_FORMATS = ["stl", "obj", "ply", "vtk"]

@pytest.fixture(scope="module")
def engine():
    return ModelingEngine()

def load_dicom_data(directory):
    # Assuming ModelingEngine has a method to load DICOM directory
    return ModelingEngine.load_dicom(directory)

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_dicom_processing_accuracy(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    processed_volume = engine.process_dicom(dicom_data)
    assert processed_volume is not None
    assert processed_volume.shape[0] > 0
    assert processed_volume.dtype == np.float32 or processed_volume.dtype == np.uint16

    # Spot check some stats to verify accuracy against known values (hypothetical)
    mean_intensity = np.mean(processed_volume)
    assert 20 < mean_intensity < 180

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_segmentation_quality(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    segmentation = engine.segment_volume()
    assert segmentation is not None
    assert segmentation.dtype == np.uint8 or segmentation.dtype == bool
    seg_volume = np.sum(segmentation)
    assert seg_volume > 0
    # Segmentation should cover a reasonable volume fraction
    fraction = seg_volume / np.prod(segmentation.shape)
    assert 0.001 < fraction < 0.5

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_mesh_generation_correctness(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    engine.segment_volume()
    mesh = engine.generate_mesh()
    assert mesh is not None
    # Basic mesh properties: vertices and faces arrays exist and have correct shape
    assert hasattr(mesh, "vertices")
    assert hasattr(mesh, "faces")
    assert len(mesh.vertices) > 100
    assert len(mesh.faces) > 100
    # Vertices should be 3D points
    verts = np.array(mesh.vertices)
    assert verts.shape[1] == 3
    # Faces should be triangles or polygons (at least 3 indices)
    faces = np.array(mesh.faces)
    assert faces.shape[1] >= 3

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_geometric_analysis_precision(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    engine.segment_volume()
    engine.generate_mesh()
    geo_metrics = engine.compute_geometric_metrics()
    # Check presence and validity of metrics
    assert isinstance(geo_metrics, dict)
    assert "volume" in geo_metrics and geo_metrics["volume"] > 0
    assert "surface_area" in geo_metrics and geo_metrics["surface_area"] > 0
    assert "compactness" in geo_metrics and 0 < geo_metrics["compactness"] < 1

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_model_validation_catches_errors(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    engine.segment_volume()
    engine.generate_mesh()

    # Valid model should pass validation
    valid, errors = engine.validate_model()
    assert valid is True
    assert errors == []

    # Introduce error artificially and test validation
    engine.mesh.vertices = []  # clear vertices to simulate error
    valid, errors = engine.validate_model()
    assert valid is False
    assert len(errors) > 0

@pytest.mark.parametrize("fmt", EXPORT_FORMATS)
@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_export_format_compatibility(engine, dicom_dir, fmt):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    engine.segment_volume()
    engine.generate_mesh()

    try:
        export_data = engine.export_model(fmt)
        assert export_data is not None
        # For string/binary exports, ensure non-empty bytes or string returned
        if isinstance(export_data, (bytes, str)):
            assert len(export_data) > 0
        # Alternatively handle file-like or dict outputs if supported
    except ExportFormatError:
        pytest.fail(f"Export format '{fmt}' raised ExportFormatError unexpectedly")

def test_processing_performance_benchmarks(engine):
    dicom_data = load_dicom_data(VALID_CT_DIR)

    start_time = time.perf_counter()
    engine.process_dicom(dicom_data)
    p1 = time.perf_counter()

    engine.segment_volume()
    p2 = time.perf_counter()

    engine.generate_mesh()
    p3 = time.perf_counter()

    # Define performance thresholds (seconds, hypothetical)
    assert (p1 - start_time) < 10
    assert (p2 - p1) < 20
    assert (p3 - p2) < 15

def test_memory_usage_optimization(engine):
    process = psutil.Process()

    mem_before = process.memory_info().rss
    dicom_data = load_dicom_data(VALID_CT_DIR)
    engine.process_dicom(dicom_data)
    engine.segment_volume()
    engine.generate_mesh()
    mem_after = process.memory_info().rss

    # Memory increase should be reasonable, e.g. less than 500MB
    assert (mem_after - mem_before) < 500 * 1024 * 1024

@pytest.mark.parametrize("dicom_dir", [POOR_QUALITY_CT_DIR, ARTIFACT_CT_DIR])
def test_edge_cases_handling(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)

    # Expect either graceful failure or warnings but no crashes
    try:
        processed = engine.process_dicom(dicom_data)
    except DICOMProcessingError:
        pytest.skip("DICOM processing failed as expected for poor quality data")
    else:
        assert processed is not None

    try:
        engine.segment_volume()
    except SegmentationError:
        pytest.skip("Segmentation failed gracefully due to poor scan quality")
    else:
        seg = engine.get_segmentation()
        assert seg is not None

    try:
        engine.generate_mesh()
    except MeshGenerationError:
        pytest.skip("Mesh generation failed gracefully due to artifacts")
    else:
        mesh = engine.get_mesh()
        assert mesh is not None

@pytest.mark.parametrize("dicom_dir", [VALID_CT_DIR])
def test_full_pipeline_consistency(engine, dicom_dir):
    dicom_data = load_dicom_data(dicom_dir)
    engine.process_dicom(dicom_data)
    segmentation1 = engine.segment_volume()
    mesh1 = engine.generate_mesh()
    geo_metrics1 = engine.compute_geometric_metrics()

    # Re-run segmentation and mesh to check for deterministic results
    segmentation2 = engine.segment_volume()
    mesh2 = engine.generate_mesh()
    geo_metrics2 = engine.compute_geometric_metrics()

    assert np.array_equal(segmentation1, segmentation2)
    assert len(mesh1.vertices) == len(mesh2.vertices)
    assert len(mesh1.faces) == len(mesh2.faces)
    for key in geo_metrics1:
        np.testing.assert_allclose(geo_metrics1[key], geo_metrics2[key], rtol=1e-5)
```