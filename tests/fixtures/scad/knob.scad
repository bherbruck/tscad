// Customizable knob with grip notches and a D-shaft bore
radius = 15;     // [8:40]
height = 12;     // [5:30]
notches = 12;    // [0:36]
notch_r = 2;     // [1:0.5:5]
shaft_d = 6;     // [3:0.5:10]
flat = 1.5;      // distance from the shaft axis to the flat
bore_depth = 9;

$fn = 64;

module d_shaft(d, depth, flat) {
  difference() {
    cylinder(d = d, h = depth);
    translate([flat, -d, -1]) cube([2 * d, 2 * d, depth + 2]);
  }
}

difference() {
  cylinder(r = radius, h = height);
  for (i = [0 : notches - 1])
    rotate([0, 0, i * 360 / notches]) translate([radius, 0, -1]) cylinder(r = notch_r, h = height + 2);
  translate([0, 0, -1]) d_shaft(shaft_d, bore_depth + 1, flat);
}
