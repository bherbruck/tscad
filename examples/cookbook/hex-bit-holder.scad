// Hex bit holder: a block with a grid of hexagonal sockets for 1/4" driver bits.
/* [Holder] */
// Bits per row
columns = 6; // [2:1:12]
// Rows
rows = 2; // [1:1:4]
// Socket depth
depth = 12; // [6:1:20]
// Clearance on the hex
clearance = 0.3; // [0:0.05:0.6]

bit = 6.35; // 1/4" across flats
pitch = 11;
base = 3;

module socket() {
  // a hexagonal socket: across flats `bit + clearance`
  cylinder(r = (bit + clearance) / sqrt(3), h = depth + 1, $fn = 6);
}

difference() {
  translate([-columns * pitch / 2, -rows * pitch / 2, 0])
    cube([columns * pitch, rows * pitch, depth + base]);
  for (i = [0 : columns - 1], j = [0 : rows - 1])
    translate([(i - (columns - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch, base])
      socket();
}
