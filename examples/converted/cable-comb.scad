// Cable comb: keeps a bundle of wires parallel
cables = 6;          // [2:20]
cable_d = 5.5;       // [2:0.1:12]
spacing = 2;         // [1:0.5:6]
thickness = 4;       // [2:10]
slot = 0.8;          // fraction of cable_d left open [0.5:0.05:1]

pitch = cable_d + spacing;
width = cables * pitch + spacing;
height = cable_d + 2 * spacing;

linear_extrude(height = thickness)
  difference() {
    offset(r = 1) offset(delta = -1) square([width, height]);
    for (i = [0 : cables - 1]) {
      x = spacing + cable_d / 2 + i * pitch;
      translate([x, height / 2]) circle(d = cable_d);
      translate([x - cable_d * slot / 2, height / 2]) square([cable_d * slot, height]);
    }
  }
