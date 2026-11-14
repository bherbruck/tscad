// Parametric electronics enclosure with screw posts and a snap lid
/* [Inside dimensions] */
inner_x = 70;   // [20:200]
inner_y = 45;   // [20:200]
inner_z = 25;   // [10:100]
/* [Walls] */
wall = 2;       // [1:0.2:5]
floor_t = 2;    // [1:0.2:5]
corner_r = 3;   // [0:0.5:10]
/* [Screw posts] */
post_d = 6;     // [4:0.5:12]
screw_d = 2.5;  // [1.5:0.1:5]
post_inset = 4; // [3:15]
/* [Hidden] */
$fn = 48;
eps = 0.01;

outer = [inner_x + 2 * wall, inner_y + 2 * wall, inner_z + floor_t];

module rounded_box(size, r) {
  hull()
    for (x = [r, size[0] - r], y = [r, size[1] - r])
      translate([x, y, 0]) cylinder(r = r, h = size[2]);
}

module post_positions() {
  for (x = [wall + post_inset, outer[0] - wall - post_inset])
    for (y = [wall + post_inset, outer[1] - wall - post_inset])
      translate([x, y, 0]) children();
}

module enclosure() {
  difference() {
    rounded_box(outer, corner_r);
    translate([wall, wall, floor_t]) cube([inner_x, inner_y, inner_z + eps]);
  }
  post_positions()
    difference() {
      cylinder(d = post_d, h = inner_z * 0.8 + floor_t);
      translate([0, 0, floor_t]) cylinder(d = screw_d, h = inner_z);
    }
}

enclosure();
