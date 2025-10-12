```python
import os
import numpy as np
import SimpleITK as sitk
import vtk
from vtk.util import numpy_support
from vtk.util.vtkAlgorithm import VTKPythonAlgorithmBase


class ModelingEngine3D:
    def __init__(self):
        self.volume = None
        self.segmented = None
        self.mesh = None
        self.centerlines = None

    def load_dicom_series(self, directory_path):
        reader = sitk.ImageSeriesReader()
        series_ids = reader.GetGDCMSeriesIDs(directory_path)
        if not series_ids:
            raise FileNotFoundError(f"No DICOM series found in {directory_path}")
        series_file_names = reader.GetGDCMSeriesFileNames(directory_path, series_ids[0])
        reader.SetFileNames(series_file_names)
        self.volume = reader.Execute()
        return self.volume

    def artery_segmentation(self, lower_thresh=150, upper_thresh=1000, smoothing_iterations=5):
        if self.volume is None:
            raise RuntimeError("No volume loaded")

        # Thresholding: Hounsfield unit approx. range for contrast-enhanced arteries
        thresh_img = sitk.BinaryThreshold(self.volume, lowerThreshold=lower_thresh, upperThreshold=upper_thresh, insideValue=1, outsideValue=0)
        # Connected component analysis, keep largest component to focus on artery tree
        cc = sitk.ConnectedComponent(thresh_img)

        stats = sitk.LabelShapeStatisticsImageFilter()
        stats.Execute(cc)
        largest_label = max(stats.GetLabels(), key=lambda l: stats.GetPhysicalSize(l))
        artery_mask = sitk.BinaryThreshold(cc, lowerThreshold=largest_label, upperThreshold=largest_label, insideValue=1, outsideValue=0)

        # Morphological smoothing (binary closing)
        artery_mask = sitk.BinaryMorphologicalClosing(artery_mask, (3,3,3), sitk.sitkBall)
        for _ in range(smoothing_iterations):
            artery_mask = sitk.BinaryMorphologicalClosing(artery_mask, (1,1,1), sitk.sitkBall)

        self.segmented = artery_mask
        return self.segmented

    def mesh_generation(self, iso_value=0.5, decimation_reduction=0.7, smoothing_iterations=30, smoothing_relax=0.01):
        if self.segmented is None:
            raise RuntimeError("No segmented volume available")

        # Convert SimpleITK image to numpy array
        seg_np = sitk.GetArrayFromImage(self.segmented).astype(np.float32)
        seg_np = np.flip(seg_np, axis=0)  # Flip z-axis for correct orientation

        # Create vtkImageData from numpy array
        depth, height, width = seg_np.shape
        vtk_image = vtk.vtkImageData()
        vtk_image.SetDimensions(width, height, depth)
        spacing = self.segmented.GetSpacing()
        vtk_image.SetSpacing(spacing[0], spacing[1], spacing[2])
        origin = self.segmented.GetOrigin()
        vtk_image.SetOrigin(origin[0], origin[1], origin[2])

        flat_data = seg_np.ravel(order='F')
        vtk_array = numpy_support.numpy_to_vtk(num_array=flat_data, deep=True, array_type=vtk.VTK_FLOAT)
        vtk_image.GetPointData().SetScalars(vtk_array)

        mc = vtk.vtkMarchingCubes()
        mc.SetInputData(vtk_image)
        mc.SetValue(0, iso_value)
        mc.Update()

        # Decimate to reduce mesh complexity
        decimate = vtk.vtkDecimatePro()
        decimate.SetInputConnection(mc.GetOutputPort())
        decimate.SetTargetReduction(decimation_reduction)  # e.g. 0.7 = reduce to 30% of original
        decimate.PreserveTopologyOn()
        decimate.Update()

        # Smooth the mesh
        smooth = vtk.vtkSmoothPolyDataFilter()
        smooth.SetInputConnection(decimate.GetOutputPort())
        smooth.SetNumberOfIterations(smoothing_iterations)
        smooth.SetRelaxationFactor(smoothing_relax)
        smooth.FeatureEdgeSmoothingOff()
        smooth.BoundarySmoothingOn()
        smooth.Update()

        self.mesh = smooth.GetOutput()
        return self.mesh

    def extract_centerlines(self, source_seed, target_seed, radius_array_name='Radius'):
        """
        Extract centerlines using VTK's vmtkCenterlines

        Parameters:
          - source_seed: (x,y,z) tuple or list for start of artery (root)
          - target_seed: (x,y,z) tuple or list for distal end or branch point(s)

        Returns:
          - centerlines vtkPolyData object
        """

        if self.mesh is None:
            raise RuntimeError("Mesh not generated yet")

        # Prepare seed points as vtkPoints
        source_points = vtk.vtkPoints()
        source_points.InsertNextPoint(source_seed)
        target_points = vtk.vtkPoints()
        target_points.InsertNextPoint(target_seed)

        # Use VMTK python module centerlines if available, else fallback to vtkStreamTracer or similar.
        try:
            from vmtk import vmtkscripts

            surface = self.mesh

            centerline_filter = vmtkscripts.vmtkCenterlines()
            centerline_filter.Surface = surface
            centerline_filter.SeedSelectorName = 'pointlist'
            centerline_filter.SourcePoints = source_points
            centerline_filter.TargetPoints = target_points
            centerline_filter.RadiusArrayName = radius_array_name
            centerline_filter.Execute()

            self.centerlines = centerline_filter.Centerlines
            return self.centerlines

        except ImportError:
            raise ImportError("VMTK is required for centerline extraction. Please install vmtk.")

    def measure_diameter_and_length(self):
        if self.centerlines is None:
            raise RuntimeError("Centerlines not computed")

        # Diameter measurement from radius array on centerlines
        radii = []
        lengths = []

        points = self.centerlines.GetPoints()
        radius_array = self.centerlines.GetPointData().GetArray('Radius')
        if radius_array is None:
            raise RuntimeError("Radius array not found in centerlines")

        number_of_points = points.GetNumberOfPoints()
        total_length = 0.0
        for i in range(number_of_points):
            r = radius_array.GetTuple1(i)
            radii.append(r*2)  # Diameter = 2*radius

            if i > 0:
                p0 = np.array(points.GetPoint(i-1))
                p1 = np.array(points.GetPoint(i))
                seg_len = np.linalg.norm(p1 - p0)
                total_length += seg_len
                lengths.append(seg_len)

        mean_diameter = np.mean(radii) if radii else 0
        total_length = sum(lengths) if lengths else 0

        return {
            'mean_diameter_mm': mean_diameter,
            'total_length_mm': total_length,
            'diameters_along_centerline_mm': radii,
            'segment_lengths_mm': lengths
        }

    def optimize_mesh_for_rendering(self, target_poly_count=5000):
        if self.mesh is None:
            raise RuntimeError("Mesh not generated")

        decimate = vtk.vtkDecimatePro()
        decimate.SetInputData(self.mesh)
        original_polys = self.mesh.GetNumberOfPolys()
        if original_polys <= target_poly_count:
            return self.mesh

        reduction = 1.0 - (target_poly_count / original_polys)
        decimate.SetTargetReduction(reduction)
        decimate.PreserveTopologyOn()
        decimate.Update()

        self.mesh = decimate.GetOutput()
        return self.mesh

    def export_mesh(self, filepath, file_format=None):
        if self.mesh is None:
            raise RuntimeError("No mesh to export")

        ext = None
        if file_format is not None:
            ext = file_format.lower()
        else:
            ext = os.path.splitext(filepath)[1].lower().replace('.', '')

        if ext == 'stl':
            writer = vtk.vtkSTLWriter()
            writer.SetFileName(filepath)
            writer.SetInputData(self.mesh)
            writer.Write()
        elif ext == 'obj':
            writer = vtk.vtkOBJWriter()
            writer.SetFileName(filepath)
            writer.SetInputData(self.mesh)
            writer.Write()
        elif ext in ('gltf', 'glb'):
            try:
                import trimesh
                trimesh_mesh = self._vtk_to_trimesh(self.mesh)
                if ext == 'gltf':
                    trimesh_mesh.export(filepath, file_type='glb')  # gltf binary format
                else:
                    trimesh_mesh.export(filepath, file_type='glb')
            except ImportError:
                raise ImportError("trimesh package is required for glTF/glb export")
        else:
            raise ValueError(f"Unsupported export format: {ext}")

    def _vtk_to_trimesh(self, vtk_polydata):
        import trimesh
        vertices = numpy_support.vtk_to_numpy(vtk_polydata.GetPoints().GetData())
        polys = numpy_support.vtk_to_numpy(vtk_polydata.GetPolys().GetData())
        # polys layout: [n_vertices,p0, p1, ..., n_vertices,p0, p1, ...]
        # Extract triangles (or polygons with 3 vertices)
        faces = []
        idx = 0
        while idx < len(polys):
            n_verts = polys[idx]
            idx += 1
            face = polys[idx:idx+n_verts]
            idx += n_verts
            if n_verts == 3:
                faces.append(face)
            else:
                # triangulate polygon with >3 vertices (simple fan)
                for i in range(1, n_verts-1):
                    faces.append([face[0], face[i], face[i+1]])
        return trimesh.Trimesh(vertices=vertices, faces=np.array(faces))

    def reset(self):
        self.volume = None
        self.segmented = None
        self.mesh = None
        self.centerlines = None


if __name__ == "__main__":
    # Basic test placeholder: load DICOM, segment, mesh, and export STL
    import argparse

    parser = argparse.ArgumentParser(description="3D Coronary Artery Modeling Engine")
    parser.add_argument("dicom_folder", help="Path to folder with DICOM CT series")
    parser.add_argument("output_mesh", help="Output mesh filename (STL/OBJ)")
    args = parser.parse_args()

    engine = ModelingEngine3D()
    print("Loading DICOM series...")
    engine.load_dicom_series(args.dicom_folder)

    print("Segmenting coronary arteries...")
    engine.artery_segmentation(lower_thresh=150, upper_thresh=1000)

    print("Generating 3D mesh...")
    engine.mesh_generation()

    print("Optimizing mesh for rendering...")
    engine.optimize_mesh_for_rendering(target_poly_count=10000)

    print(f"Exporting mesh to {args.output_mesh}")
    engine.export_mesh(args.output_mesh)

    print("Done.")
```