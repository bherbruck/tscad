// Gridfinity-style storage bin: rounded base pads on a 42 mm grid, hollow walls
units_x = 2;       // [1:6]
units_y = 1;       // [1:6]
height_u = 3;      // [1:10]
/* [Hidden] */
grid = 42;
pad = 41.5;
pad_r = 4;
base_h = 5;
unit_h = 7;
wall = 1.2;

module rounded_square(s, r) {
  offset(r = r) square([s[0] - 2 * r, s[1] - 2 * r], center = true);
}

module base_pad() {
  hull() {
    translate([0, 0, 0]) linear_extrude(0.8) rounded_square([pad - 4.3, pad - 4.3], 1.6);
    translate([0, 0, 2.6]) linear_extrude(base_h - 2.6) rounded_square([pad, pad], pad_r);
  }
}

module bin_body() {
  w = units_x * grid - 0.5;
  d = units_y * grid - 0.5;
  h = height_u * unit_h;
  translate([0, 0, base_h])
    difference() {
      linear_extrude(h) rounded_square([w, d], pad_r);
      translate([0, 0, wall]) linear_extrude(h) rounded_square([w - 2 * wall, d - 2 * wall], pad_r - wall);
    }
}

for (i = [0 : units_x - 1], j = [0 : units_y - 1])
  translate([(i - (units_x - 1) / 2) * grid, (j - (units_y - 1) / 2) * grid, 0]) base_pad();
bin_body();
