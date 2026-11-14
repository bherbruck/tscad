// Plate cam: a base circle and a nose circle joined by tangents, with a bore
base_r = 12;     // [6:30]
nose_r = 5;      // [2:15]
lift = 10;       // [2:30]
thickness = 6;   // [2:20]
bore = 6;        // [2:0.5:12]

linear_extrude(height = thickness)
  difference() {
    hull() {
      circle(r = base_r);
      translate([base_r + lift - nose_r, 0]) circle(r = nose_r);
    }
    circle(d = bore);
  }
