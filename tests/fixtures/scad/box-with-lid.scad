// Parametric box with a friction-fit lid
/* [Box] */
// Outer width
width = 60; // [20:1:200]
// Outer depth
depth = 40; // [20:200]
height = 25; // [10:0.5:100]
wall = 2;   // [1:0.1:5]
/* [Lid] */
// Which part to print
part = "both"; // [base, lid, both]
lid_height = 6; // [3:20]

/* [Hidden] */
gap = 0.4;

module shell(w, d, h, t) {
  difference() {
    cube([w, d, h]);
    translate([t, t, t]) cube([w - 2*t, d - 2*t, h]);
  }
}

module lid() {
  inset = wall + gap;
  translate([width + 10, 0, 0]) {
    cube([width, depth, wall]);
    translate([inset, inset, wall])
      cube([width - 2*inset, depth - 2*inset, lid_height - wall]);
  }
}

if (part != "lid") shell(width, depth, height, wall);
if (part != "base") lid();
