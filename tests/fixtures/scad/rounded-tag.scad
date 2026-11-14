// Key tag: a plate with rounded corners (hull of four cylinders) and a key-ring hole
length = 50;    // [30:100]
width = 25;     // [15:60]
thickness = 3;  // [1:0.5:6]
corner = 5;     // [1:12]
hole = 3;       // [1:0.5:6]

difference() {
  hull()
    for (x = [corner, length - corner], y = [corner, width - corner])
      translate([x, y, 0]) cylinder(r = corner, h = thickness);
  translate([corner + 1, width / 2, -1]) cylinder(r = hole, h = thickness + 2);
}
