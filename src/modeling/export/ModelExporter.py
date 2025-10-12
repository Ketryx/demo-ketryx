```python
import os
import json
import tempfile
import zipfile
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset
from datetime import datetime
from io import BytesIO

import trimesh
import vtk
from vtk.util import numpy_support


class ModelExporter:
    def __init__(self, mesh, metadata=None, coordsys_from="RAS", coordsys_to="RAS"):
        """
        :param mesh: trimesh.Trimesh instance representing the 3D model
        :param metadata: dict with key-value pairs to embed as metadata
        :param coordsys_from: Coordinate system of input mesh, e.g. 'RAS', 'LPS', etc.
        :param coordsys_to: Desired coordinate system for export
        """
        if not isinstance(mesh, trimesh.Trimesh):
            raise TypeError("mesh must be a trimesh.Trimesh instance")

        self.mesh = mesh.copy()
        self.metadata = metadata or {}

        if coordsys_from != coordsys_to:
            self._transform_coordinate_system(coordsys_from, coordsys_to)

    def _transform_coordinate_system(self, from_sys, to_sys):
        # Supported systems: RAS, LPS (only these implemented here)
        # RAS: Right-Anterior-Superior
        # LPS: Left-Posterior-Superior
        # Transformation: multiply vertex coords by diag(-1, -1, 1) to switch RAS<->LPS
        if {from_sys, to_sys} == {"RAS", "LPS"}:
            transform = np.diag([-1, -1, 1, 1])
            homog = np.hstack((self.mesh.vertices, np.ones((len(self.mesh.vertices), 1))))
            transformed = (transform @ homog.T).T[:, :3]
            self.mesh.vertices = transformed
        elif from_sys == to_sys:
            pass  # no transform needed
        else:
            raise ValueError(f"Coordinate transformation from {from_sys} to {to_sys} not supported")

    def _embed_metadata_in_stl(self, filepath):
        # ASCII STL supports a header, binary STL has an 80-byte header we can fill but limited
        # We'll create ASCII STL and prepend metadata as comments
        header_lines = ["solid metadata"]
        for k, v in self.metadata.items():
            header_lines.append(f"  // {k}: {v}")
        header_lines.append("endsolid metadata\n")

        ascii_stl = self.mesh.export(file_type="stl_ascii")
        ascii_stl_str = ascii_stl.decode("utf-8") if isinstance(ascii_stl, bytes) else ascii_stl

        ascii_stl_str = "\n".join(header_lines) + ascii_stl_str

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(ascii_stl_str)

    def export_stl(self, filepath, ascii=True, compress=False):
        """
        Export model to STL format.
        :param filepath: Output file path with .stl or .stl.gz extension
        :param ascii: Export as ASCII STL if True, else binary STL
        :param compress: If True, compress output with GZip (will append .gz if not present)
        """
        ext = os.path.splitext(filepath)[1].lower()
        if compress and not filepath.endswith(".gz"):
            filepath += ".gz"

        if ascii:
            # STL ASCII with embedded metadata as comments
            tmpfile = filepath
            if compress:
                # write to temp uncompressed file first
                tmpfd, tmpfile = tempfile.mkstemp(suffix=".stl")
                os.close(tmpfd)
                self._embed_metadata_in_stl(tmpfile)
                with open(tmpfile, "rb") as fin, gzip.open(filepath, "wb") as fout:
                    fout.writelines(fin)
                os.remove(tmpfile)
            else:
                self._embed_metadata_in_stl(filepath)
        else:
            # binary STL export - metadata embedding not supported beyond header (80b)
            # Fill binary header with metadata JSON if possible (max 80 bytes)
            header_json = json.dumps(self.metadata)[:80].ljust(80)
            data = self.mesh.export(file_type="stl")
            # data is bytes. Replace first 80 bytes with header_json
            data = header_json.encode("ascii") + data[80:]
            if compress:
                import gzip

                with gzip.open(filepath, "wb") as f:
                    f.write(data)
            else:
                with open(filepath, "wb") as f:
                    f.write(data)

    def export_obj(self, filepath, mtl_file=None, compress=False):
        """
        Export model to OBJ format with optional MTL for materials.
        :param filepath: Output .obj path
        :param mtl_file: Optional path for .mtl file to store materials
        :param compress: If True compress output .obj and .mtl into a zip archive
        """
        obj_bytes = self.mesh.export(file_type="obj")
        obj_str = obj_bytes.decode("utf-8") if isinstance(obj_bytes, bytes) else obj_bytes

        mtl_name = os.path.basename(mtl_file) if mtl_file else None
        if mtl_name:
            # Replace mtllib line or add it
            lines = obj_str.splitlines()
            new_lines = []
            mtllib_found = False
            for li in lines:
                if li.startswith("mtllib"):
                    new_lines.append(f"mtllib {mtl_name}")
                    mtllib_found = True
                else:
                    new_lines.append(li)
            if not mtllib_found:
                new_lines.insert(0, f"mtllib {mtl_name}")
            obj_str = "\n".join(new_lines)

        if compress:
            import zipfile

            arcname_obj = os.path.basename(filepath)
            arcname_mtl = os.path.basename(mtl_file) if mtl_file else None
            with zipfile.ZipFile(filepath if filepath.lower().endswith(".zip") else filepath + ".zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(arcname_obj, obj_str)
                if mtl_file:
                    mtl_content = self._generate_mtl()
                    zf.writestr(arcname_mtl, mtl_content)
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(obj_str)
            if mtl_file:
                with open(mtl_file, "w", encoding="utf-8") as f:
                    f.write(self._generate_mtl())

    def _generate_mtl(self):
        # Simple MTL generator using metadata materials if any
        # Example: if metadata has keys color or material
        color = self.metadata.get("color", [0.8, 0.8, 0.8])  # default grey
        if isinstance(color, str):
            # Try HEX to normalize
            if color.startswith("#") and len(color) == 7:
                r = int(color[1:3], 16) / 255
                g = int(color[3:5], 16) / 255
                b = int(color[5:7], 16) / 255
                color = [r, g, b]
            else:
                color = [0.8, 0.8, 0.8]
        elif isinstance(color, (list, tuple)) and len(color) == 3:
            # normalize if >1
            if any(c > 1 for c in color):
                color = [c / 255 for c in color]

        material_name = self.metadata.get("material_name", "material_1")

        # Ambient, diffuse, specular colors = color (for simplicity)
        mtl = f"""newmtl {material_name}
Ka {color[0]:.4f} {color[1]:.4f} {color[2]:.4f}
Kd {color[0]:.4f} {color[1]:.4f} {color[2]:.4f}
Ks 0.1 0.1 0.1
Ns 10.0
d 1.0
illum 2
"""
        return mtl

    def export_gltf(self, filepath, binary=False, embed_metadata=True, compress=False):
        """
        Export model as glTF (JSON+buffers) or GLB (binary glTF).
        :param filepath: Output file path ending with .gltf or .glb
        :param binary: True for GLB binary format, False for JSON glTF
        :param embed_metadata: Embed metadata in glTF extras if True
        :param compress: If True compress output file with gzip (.gz extension added if needed)
        """
        ext = os.path.splitext(filepath)[1].lower()
        if ext not in (".gltf", ".glb"):
            if binary:
                filepath += ".glb"
            else:
                filepath += ".gltf"

        export_kwargs = {}
        if embed_metadata and self.metadata:
            export_kwargs["extras"] = self.metadata.copy()

        exported = self.mesh.export(file_type="glb" if binary else "gltf", **export_kwargs)

        if compress:
            import gzip

            if not filepath.endswith(".gz"):
                filepath += ".gz"
            with gzip.open(filepath, "wb") as f:
                if binary:
                    # exported is bytes
                    f.write(exported)
                else:
                    # exported is JSON string or bytes -> ensure bytes
                    if isinstance(exported, bytes):
                        f.write(exported)
                    else:
                        f.write(exported.encode("utf-8"))
        else:
            if binary:
                # exported is bytes
                with open(filepath, "wb") as f:
                    f.write(exported)
            else:
                # exported is JSON string or bytes
                if isinstance(exported, bytes):
                    exported = exported.decode("utf-8")
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(exported)

    def export_dicom_seg(self, filepath, compress=False):
        """
        Export segmented mesh as a DICOM-SEG object.
        This is a simplified implementation:
          - voxelizes the mesh into a 3D numpy array (binary mask)
          - writes DICOM SEG with metadata
        :param filepath: Output .dcm filename
        :param compress: Compress with gzip if True (.gz extension appended if missing)
        """
        # Parameters for voxelization
        voxel_size = self.metadata.get("voxel_size_mm", 1.0)  # mm per voxel

        # Compute bounding box and dimensions
        bbox_min = self.mesh.bounds[0]
        bbox_max = self.mesh.bounds[1]
        dim = np.ceil((bbox_max - bbox_min) / voxel_size).astype(int) + 3  # margin padding

        # Create a grid
        grid_origin = bbox_min - voxel_size  # offset a bit for margin

        # Voxelization via trimesh.voxel
        voxelized = self.mesh.voxelized(pitch=voxel_size)
        matrix = voxelized.matrix.astype(np.uint8)

        # Create minimal DICOM SEG dataset
        file_meta = pydicom.Dataset()
        file_meta.MediaStorageSOPClassUID = pydicom.uid.generate_uid()
        file_meta.MediaStorageSOPInstanceUID = pydicom.uid.generate_uid()
        file_meta.TransferSyntaxUID = pydicom.uid.ImplicitVRLittleEndian

        ds = FileDataset(filepath, {}, file_meta=file_meta, preamble=b"\0" * 128)
        ds.Modality = "SEG"
        ds.ContentDate = datetime.now().strftime("%Y%m%d")
        ds.ContentTime = datetime.now().strftime("%H%M%S")
        ds.SeriesDescription = "Segmented Model Export"
        ds.PatientName = self.metadata.get("patient_name", "Anon")
        ds.PatientID = self.metadata.get("patient_id", "0000")
        ds.Rows = matrix.shape[1]
        ds.Columns = matrix.shape[2]
        ds.NumberOfFrames = matrix.shape[0]

        # Dispatcher data values for DICOM segmentation minimal compliance, this is a demonstrative snippet
        # PixelData needs to be a bytestring with all frames concatenated, each frame a 2D binary mask
        # Each voxel is a bit - null padding added per frame to fill to byte alignment
        bit_planes = 1
        pixels_per_frame = ds.Rows * ds.Columns
        bytes_per_frame = (pixels_per_frame + 7) // 8

        # Pack each frame bits into bytes
        frames_bytes = BytesIO()
        for frame_idx in range(matrix.shape[0]):
            frame_2d = matrix[frame_idx, :, :]
            bits = frame_2d.flatten()
            # pad bits to multiple of 8
            pad = (8 - (len(bits) % 8)) % 8
            bits_padded = np.hstack([bits, np.zeros(pad, dtype=np.uint8)])
            # pack bits to bytes
            byte_vals = np.packbits(bits_padded)
            frames_bytes.write(byte_vals.tobytes())
        ds.PixelData = frames_bytes.getvalue()

        ds.BitsAllocated = 1
        ds.BitsStored = 1
        ds.HighBit = 0
        ds.SamplesPerPixel = 1
        ds.PixelRepresentation = 0
        ds.PixelAspectRatio = [1, 1]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = list(grid_origin)
        ds.PixelSpacing = [voxel_size, voxel_size]
        ds.FrameIncrementPointer = []
        ds.Rows = int(matrix.shape[1])
        ds.Columns = int(matrix.shape[2])
        ds.NumberOfFrames = int(matrix.shape[0])

        # Embed metadata JSON in private tag (for demo)
        try:
            ds.add_new((0x0043, 0x1029), "LO", json.dumps(self.metadata))
        except Exception:
            pass

        if compress:
            import gzip

            if not filepath.endswith(".gz"):
                filepath += ".gz"
            with gzip.open(filepath, "wb") as f:
                f.write(ds.to_bytes())
        else:
            ds.save_as(filepath)

    def export_vtk(self, filepath, compress=False):
        """
        Export mesh in VTK format for analysis.
        Writes a PolyData file.
        :param filepath: Output filename ending with .vtp (XML PolyData)
        :param compress: If True compress output as .vtp.gz
        """
        if not filepath.lower().endswith(".vtp"):
            filepath += ".vtp"
        if compress and not filepath.endswith(".gz"):
            filepath += ".gz"

        # Convert trimesh to VTK PolyData
        points = vtk.vtkPoints()
        points.SetNumberOfPoints(len(self.mesh.vertices))
        for i, p in enumerate(self.mesh.vertices):
            points.SetPoint(i, p.tolist())

        polydata = vtk.vtkPolyData()
        polydata.SetPoints(points)

        # Add faces
        triangles = vtk.vtkCellArray()
        for face in self.mesh.faces:
            triangles.InsertNextCell(3, face)
        polydata.SetPolys(triangles)

        # Add metadata as field data
        for k, v in self.metadata.items():
            arr = None
            if isinstance(v, (int, float)):
                arr = numpy_support.numpy_to_vtk(np.array([v]), deep=True)
            elif isinstance(v, (list, tuple)) and all(isinstance(x, (int, float)) for x in v):
                arr = numpy_support.numpy_to_vtk(np.array(v), deep=True)
            if arr is not None:
                arr.SetName(str(k))
                polydata.GetFieldData().AddArray(arr)

        writer = vtk.vtkXMLPolyDataWriter()
        writer.SetInputData(polydata)

        if compress:
            writer.SetDataModeToAppended()
            writer.SetCompressorTypeToZLib()
        else:
            writer.SetDataModeToAscii()

        if filepath.endswith(".gz"):
            # vtk writer does not support direct gzip output, write to temp and gzip externally
            tmpfile = filepath[:-3]
            writer.SetFileName(tmpfile)
            writer.Write()
            with open(tmpfile, "rb") as fin, gzip.open(filepath, "wb") as fout:
                fout.writelines(fin)
            os.remove(tmpfile)
        else:
            writer.SetFileName(filepath)
            writer.Write()
```