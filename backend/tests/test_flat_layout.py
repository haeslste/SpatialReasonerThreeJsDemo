from collections import deque
import math

from app.scene import default_scene


def test_observer_can_reach_each_room_without_crossing_measured_obstacles() -> None:
    objects = default_scene()
    assert len(objects) <= 48
    assert len({item["id"] for item in objects}) == len(objects)

    observer = next(item for item in objects if item["id"] == "observer")
    obstacles = [item for item in objects if item["id"] not in {"floor", "observer"}]
    clearance = 0.012

    def open_cell(cell: tuple[int, int]) -> bool:
        x, z = cell[0] / 5, cell[1] / 5
        if abs(x) > 6.0 or abs(z) > 4.4:
            return False
        for item in obstacles:
            if item["position"][1] >= observer["height"]:
                continue
            cosine = abs(math.cos(item["angle"]))
            sine = abs(math.sin(item["angle"]))
            x_extent = (item["width"] * cosine + item["depth"] * sine) / 2
            z_extent = (item["width"] * sine + item["depth"] * cosine) / 2
            if (
                abs(x - item["position"][0]) < observer["width"] / 2 + x_extent + clearance
                and abs(z - item["position"][2]) < observer["depth"] / 2 + z_extent + clearance
            ):
                return False
        return True

    start = (0, 4)
    destinations = {
        "study": (0, -5),
        "bedroom": (-20, -4),
        "bathroom": (20, -4),
        "living": (-12, 15),
        "kitchen": (20, 18),
    }
    frontier = deque([start])
    reached = {start}
    while frontier:
        x, z = frontier.popleft()
        for neighbor in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
            if neighbor not in reached and open_cell(neighbor):
                reached.add(neighbor)
                frontier.append(neighbor)

    assert set(destinations.values()) <= reached


def test_furniture_is_movable_and_requested_default_poses_are_set() -> None:
    objects = {item["id"]: item for item in default_scene()}
    furniture = [item for item in objects.values() if item["supertype"] == "Furniture"]
    assert furniture and all(not item["immobile"] for item in furniture)
    assert all(item["immobile"] for item in objects.values() if item["supertype"] == "Building Element")

    for id in ("stove", "kitchen_sink", "kitchen_bar", "fridge", "bed", "wardrobe"):
        assert objects[id]["angle"] == math.pi / 2
    assert objects["dining_chair_south"]["angle"] == math.pi

    wardrobe = objects["wardrobe"]
    divider = objects["bedroom_study_divider"]
    wardrobe_right = wardrobe["position"][0] + wardrobe["depth"] / 2
    divider_left = divider["position"][0] - divider["width"] / 2
    assert 0 <= divider_left - wardrobe_right <= 0.03
