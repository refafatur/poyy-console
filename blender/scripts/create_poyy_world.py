"""Generate POYY Racing circuit buildings, winding road segment, gantry, and props in Blender.

Run with: blender --background --python blender/scripts/create_poyy_world.py
Exports blender/output/poyy-world.blend and poyy-world-assets.glb.
"""

import math
import os
import bpy

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


def make_mat(name, color, metallic=0.1, roughness=0.6, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 3.0
    return mat


def add_box(name, loc, scale, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.data.materials.append(mat)
    return obj


def build_stepped_tower(origin_x, origin_z, concrete, glass, accent):
    add_box("Tower_Podium", (origin_x, 4, origin_z), (7, 4, 7), concrete, 0.2)
    add_box("Tower_Mid", (origin_x, 15, origin_z), (5.2, 8, 5.2), glass, 0.15)
    add_box("Tower_Crown", (origin_x, 26, origin_z), (3.4, 4, 3.4), glass, 0.12)
    add_box("Tower_Beacon", (origin_x, 30.5, origin_z), (0.35, 1.5, 0.35), accent)


def build_skybridge_twins(origin_x, origin_z, concrete, glass, accent):
    add_box("Twin_West", (origin_x - 4.5, 16, origin_z), (2.4, 16, 4.2), glass, 0.15)
    add_box("Twin_East", (origin_x + 4.5, 16, origin_z), (2.4, 16, 4.2), glass, 0.15)
    add_box("Twin_Bridge", (origin_x, 20, origin_z), (4.6, 1.6, 2.6), concrete, 0.1)
    add_box("Twin_Strip", (origin_x, 21.8, origin_z), (4.4, 0.18, 2.7), accent)


def build_winding_road_curve(asphalt, curb):
    curve_data = bpy.data.curves.new("CircuitPath", type="CURVE")
    curve_data.dimensions = "3D"
    spline = curve_data.splines.new("NURBS")
    pts = [
        (0, 0, 0),
        (0, 0.5, -60),
        (35, 2.5, -120),
        (85, 3.0, -90),
        (95, 1.2, -20),
        (55, 0.0, 35),
        (0, 0.0, 45),
    ]
    spline.points.add(len(pts) - 1)
    for idx, (x, y, z) in enumerate(pts):
        spline.points[idx].co = (x, y, z, 1.0)
    spline.use_cyclic_u = True
    curve_obj = bpy.data.objects.new("CircuitCurve", curve_data)
    bpy.context.collection.objects.link(curve_obj)

    curve_data.bevel_depth = 0.0
    curve_data.extrude = 10.0
    curve_obj.data.materials.append(asphalt)

    # Start/Finish Gantry
    add_box("Gantry_Left", (-11.5, 4.5, 0), (0.6, 4.5, 0.8), concrete_mat := make_mat("GantrySteel", (0.2, 0.22, 0.26), 0.8, 0.35), 0.05)
    add_box("Gantry_Right", (11.5, 4.5, 0), (0.6, 4.5, 0.8), concrete_mat, 0.05)
    add_box("Gantry_Beam", (0, 8.8, 0), (12.2, 0.9, 1.1), curb, 0.08)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    concrete = make_mat("ArchConcrete", (0.14, 0.15, 0.18), metallic=0.1, roughness=0.78)
    glass = make_mat("ArchGlass", (0.06, 0.09, 0.14), metallic=0.88, roughness=0.16)
    accent = make_mat("SignalCrimson", (0.9, 0.16, 0.14), emission=(0.95, 0.2, 0.16))
    asphalt = make_mat("TrackAsphalt", (0.09, 0.1, 0.11), metallic=0.05, roughness=0.82)

    build_stepped_tower(-28, -40, concrete, glass, accent)
    build_skybridge_twins(30, -55, concrete, glass, accent)
    build_winding_road_curve(asphalt, accent)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_DIR, "poyy-world.blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_DIR, "poyy-world-assets.glb"), export_format="GLB")


if __name__ == "__main__":
    main()
