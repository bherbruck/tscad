// Hex key holder: one hexagonal pocket per key size
sizes = [1.5, 2, 2.5, 3, 4, 5, 6];
spacing = 4;      // [2:10]
depth = 15;       // [5:40]
clearance = 0.3;  // [0:0.05:1]
base = 5;

function across_corners(f) = f / cos(30);
function offset_of(i) = i == 0 ? 0 : offset_of(i - 1) + across_corners(sizes[i - 1] + clearance) / 2 + spacing + across_corners(sizes[i] + clearance) / 2;

total = offset_of(len(sizes) - 1) + across_corners(sizes[len(sizes) - 1] + clearance) / 2 + spacing + across_corners(sizes[0] + clearance) / 2 + spacing;
width = across_corners(max(sizes) + clearance) + 2 * spacing;

difference() {
  translate([-spacing - across_corners(sizes[0] + clearance) / 2, -width / 2, 0]) cube([total, width, depth + base]);
  for (i = [0 : len(sizes) - 1])
    translate([offset_of(i), 0, base]) cylinder(d = across_corners(sizes[i] + clearance), h = depth + 1, $fn = 6);
}
