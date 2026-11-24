"""Generate detailed multi-part POYY Racing GT prototype vehicles in Blender.

Run with: blender --background --python blender/scripts/create_poyy_racer.py
Exports blender/output/poyy-racer.blend and per-livery .glb models.
"""

import os
import bpy

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")

LIVERIES = {
    "player": (0.85, 0.04, 0.05),
    "rival-cobalt": (0.08, 0.24, 0.85),
    "rival-amber": (0.88, 0.45, 0.04),
    "rival-emerald": (0.04, 0.62, 0.36),
}


def material(name, color, metallic=0.0, roughness=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 3.5
    return mat


def cube(name, location, scale, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("bevel_edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    obj.data.materials.append(mat)
    return obj


def wheel(location, mat_tire, mat_rim):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.35, depth=0.25, location=location, rotation=(0, 1.5708, 0))
    tire = bpy.context.object
    tire.name = "Tire"
    tire.data.materials.append(mat_tire)

    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.21, depth=0.265, location=location, rotation=(0, 1.5708, 0))
    rim = bpy.context.object
    rim.name = "Rim"
    rim.data.materials.append(mat_rim)


def build_car(livery_name, body_color):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    paint = material(f"Paint_{livery_name}", body_color, metallic=0.78, roughness=0.22)
    carbon = material("Carbon", (0.03, 0.03, 0.04), metallic=0.25, roughness=0.68)
    glass = material("CanopyGlass", (0.02, 0.04, 0.06), metallic=0.92, roughness=0.1)
    tire = material("Tire", (0.015, 0.016, 0.02), metallic=0.0, roughness=0.72)
    rim = material("Rim", (0.65, 0.68, 0.74), metallic=0.95, roughness=0.18)
    headlight = material("Headlight", (0.95, 0.98, 1.0), emission=(0.95, 0.98, 1.0))
    taillight = material("Taillight", (1.0, 0.08, 0.08), emission=(1.0, 0.08, 0.08))

    # Primary hull + sculpted nose + canopy + aero kit
    cube("ChassisMain", (0, 0.48, 0), (0.95, 0.24, 2.05), paint, 0.12)
    cube("FrontSplitter", (0, 0.24, -1.96), (0.98, 0.05, 0.34), carbon, 0.02)
    cube("SideSkirtL", (-0.98, 0.27, 0), (0.06, 0.08, 1.45), carbon, 0.02)
    cube("SideSkirtR", (0.98, 0.27, 0), (0.06, 0.08, 1.45), carbon, 0.02)
    cube("Canopy", (0, 0.84, -0.1), (0.66, 0.22, 0.92), glass, 0.16)
    cube("RearWing", (0, 1.06, 1.88), (0.96, 0.04, 0.22), carbon, 0.02)
    cube("WingStrutL", (-0.54, 0.82, 1.82), (0.04, 0.24, 0.12), carbon, 0.01)
    cube("WingStrutR", (0.54, 0.82, 1.82), (0.04, 0.24, 0.12), carbon, 0.01)
    cube("HeadlightBar", (0, 0.44, -2.06), (0.82, 0.05, 0.04), headlight)
    cube("TaillightBar", (0, 0.56, 2.06), (0.84, 0.06, 0.04), taillight)

    for x in (-0.98, 0.98):
        for z in (-1.28, 1.28):
            wheel((x, 0.35, z), tire, rim)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if livery_name == "player":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_DIR, "poyy-racer.blend"))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUTPUT_DIR, f"poyy-racer-{livery_name}.glb"),
        export_format="GLB",
    )


def main():
    for name, color in LIVERIES.items():
        build_car(name, color)


if __name__ == "__main__":
    main()
