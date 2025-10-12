```python
import numpy as np
import scipy.ndimage
from skimage import measure
import trimesh


class MeshGenerator:
    def __init__(self):
        pass

    def generate_mesh(self, volume, spacing=(1.0, 1.0, 1.0), level=0.5):
        """
        Generate an initial mesh from volumetric segmented data using marching cubes.

        Parameters
        ----------
        volume : 3D numpy array (binary or probability segmentation)
            Segmented volumetric data.
        spacing : tuple of float
            Voxel spacing in (z, y, x) directions.
        level : float
            Isosurface level for marching cubes.

        Returns
        -------
        mesh : trimesh.Trimesh
            Initial raw mesh extracted.
        """
        verts, faces, normals, values = measure.marching_cubes(volume, level=level, spacing=spacing)
        mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals, process=False)
        return mesh

    def decimate_mesh(self, mesh, target_fraction=0.5):
        """
        Optimize mesh by reducing polygon count (mesh decimation).

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Input mesh.
        target_fraction : float
            Fraction of original faces to retain (0 < target_fraction <= 1).

        Returns
        -------
        decimated_mesh : trimesh.Trimesh
            Decimated mesh optimized for performance.
        """
        # Use built-in simplification if available (requires pyglet-enabled trimesh or open3d integration)
        try:
            decimated_mesh = mesh.simplify_quadratic_decimation(int(mesh.faces.shape[0] * target_fraction))
        except Exception:
            # Fallback: naive vertex clustering decimation
            voxel_size = mesh.scale / (mesh.faces.shape[0] * (1 / target_fraction)) ** (1 / 2)
            decimated_mesh = mesh.simplify_vertex_clustering(voxel_size=voxel_size)
        return decimated_mesh

    def smooth_mesh(self, mesh, method='taubin', iterations=10, lamb=0.5, mu=-0.53):
        """
        Smooth mesh surface to remove noise/artifacts.

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Input mesh.
        method : str
            'laplacian' or 'taubin'.
        iterations : int
            Number of smoothing iterations.
        lamb : float
            Laplacian smoothing factor (for Taubin method: smoothing factor).
        mu : float
            Taubin smoothing factor (negative for inflation compensation).

        Returns
        -------
        smoothed_mesh : trimesh.Trimesh
            Smoothed mesh.
        """
        V = mesh.vertices.copy()
        F = mesh.faces

        adjacency = trimesh.graph.vertex_adjacency_graph(mesh)

        def laplacian_smooth(V, adjacency, iterations, lamb):
            for _ in range(iterations):
                V_new = V.copy()
                for vidx in range(len(V)):
                    neighbors = list(adjacency[vidx])
                    if not neighbors:
                        continue
                    neighbor_pos = V[neighbors]
                    V_new[vidx] = V[vidx] + lamb * (neighbor_pos.mean(axis=0) - V[vidx])
                V = V_new
            return V

        if method == 'laplacian':
            V_smooth = laplacian_smooth(V, adjacency, iterations, lamb)
        elif method == 'taubin':
            # Taubin smoothing: alternate laplacian smoothing with lambda and mu to reduce shrinkage
            for _ in range(iterations):
                V = laplacian_smooth(V, adjacency, 1, lamb)
                V = laplacian_smooth(V, adjacency, 1, mu)
            V_smooth = V
        else:
            raise ValueError(f'Unknown smoothing method: {method}')

        smoothed_mesh = trimesh.Trimesh(vertices=V_smooth, faces=F, process=False)
        smoothed_mesh.rezero()
        smoothed_mesh.remove_duplicate_faces()
        smoothed_mesh.remove_degenerate_faces()
        return smoothed_mesh

    def calculate_vertex_normals(self, mesh, weighted=True):
        """
        Calculate accurate vertex normals.

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Mesh for normal calculation.
        weighted : bool
            Whether to weight normals by face area.

        Returns
        -------
        normals : np.ndarray, shape (n_vertices, 3)
            Computed vertex normals, normalized.
        """
        if weighted:
            normals = mesh.vertex_normals
        else:
            # Equal weight: average unweighted face normals per vertex
            face_normals = mesh.face_normals
            vertex_normals = np.zeros_like(mesh.vertices)
            for fidx, face in enumerate(mesh.faces):
                for vidx in face:
                    vertex_normals[vidx] += face_normals[fidx]
            norms = np.linalg.norm(vertex_normals, axis=1, keepdims=True)
            normals = vertex_normals / np.maximum(norms, 1e-8)
        return normals

    def generate_texture_coordinates(self, mesh, method='spherical'):
        """
        Generate texture coordinates (UV mapping) for the mesh.

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Input mesh.
        method : str
            UV mapping method: 'spherical', 'cylindrical', or 'planar'.

        Returns
        -------
        uv : np.ndarray, shape (n_vertices, 2)
            Texture coordinates.
        """
        verts = mesh.vertices - mesh.centroid

        if method == 'spherical':
            x, y, z = verts[:, 0], verts[:, 1], verts[:, 2]
            theta = np.arctan2(z, x)  # angle around the Y axis
            phi = np.arccos(y / (np.linalg.norm(verts, axis=1) + 1e-8))  # angle from Y axis
            u = (theta + np.pi) / (2 * np.pi)
            v = phi / np.pi
            uv = np.vstack((u, v)).T
        elif method == 'cylindrical':
            x, y, z = verts[:, 0], verts[:, 1], verts[:, 2]
            theta = np.arctan2(z, x)
            u = (theta + np.pi) / (2 * np.pi)
            v = (y - y.min()) / (y.max() - y.min() + 1e-8)
            uv = np.vstack((u, v)).T
        elif method == 'planar':
            x, y, _ = verts[:, 0], verts[:, 1], verts[:, 2]
            u = (x - x.min()) / (x.max() - x.min() + 1e-8)
            v = (y - y.min()) / (y.max() - y.min() + 1e-8)
            uv = np.vstack((u, v)).T
        else:
            raise ValueError(f'Invalid texture coordinate generation method: {method}')

        return uv

    def validate_mesh(self, mesh):
        """
        Validate mesh integrity and suitability for medical visualization.

        Checks include:
            - Watertightness
            - No degenerate faces
            - Normals consistency
            - Minimum number of faces/vertices

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Mesh to validate.

        Returns
        -------
        valid : bool
            True if mesh passes all validation tests.
        messages : list of str
            List of validation failure messages (empty if valid).
        """
        messages = []

        if mesh.faces.shape[0] < 10:
            messages.append("Mesh has too few faces.")
        if mesh.vertices.shape[0] < 10:
            messages.append("Mesh has too few vertices.")
        if not mesh.is_watertight:
            messages.append("Mesh is not watertight.")
        if len(mesh.faces) != len(np.unique(mesh.faces, axis=0)):
            messages.append("Mesh has duplicate faces.")
        degenerate_faces = trimesh.repair.find_degenerate_faces(mesh)
        if len(degenerate_faces) > 0:
            messages.append(f"Mesh has {len(degenerate_faces)} degenerate faces.")
        if not mesh.fix_normals():
            messages.append("Mesh normals inconsistent and failed to fix.")

        valid = len(messages) == 0
        return valid, messages

    def generate_lod_meshes(self, mesh, levels=3):
        """
        Generate multiple Levels of Detail (LOD) meshes via progressive decimation.

        Parameters
        ----------
        mesh : trimesh.Trimesh
            Original high-detail mesh.
        levels : int
            Number of LOD levels to generate (including original).

        Returns
        -------
        lod_meshes : list of trimesh.Trimesh
            LOD meshes ordered from highest to lowest detail.
        """
        lod_meshes = [mesh]
        fraction = 1.0
        for i in range(1, levels):
            fraction /= 2
            dec_mesh = self.decimate_mesh(mesh, target_fraction=fraction)
            lod_meshes.append(dec_mesh)
        return lod_meshes
```