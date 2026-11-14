// Filament spool holder: a stepped hub on a bearing bore, spokes and a rim
spool_hole = 52;      // [30:0.5:80]
bearing_od = 22;      // [10:0.1:40]
bearing_w = 7;        // [3:0.5:15]
hub_len = 30;         // [15:60]
spokes = 5;           // [3:8]
lip = 4;              // [2:10]

$fn = 96;

module spoke(len, w, t) {
  translate([0, -w / 2, 0]) cube([len, w, t]);
}

rotate_extrude()
  polygon([
    [bearing_od / 2, 0],
    [spool_hole / 2 + lip, 0],
    [spool_hole / 2 + lip, 3],
    [spool_hole / 2, 3],
    [spool_hole / 2 - 1, hub_len],
    [bearing_od / 2 + 2, hub_len],
    [bearing_od / 2 + 2, bearing_w],
    [bearing_od / 2, bearing_w]
  ]);

for (i = [0 : spokes - 1])
  rotate([0, 0, i * 360 / spokes])
    translate([bearing_od / 2 + 1, 0, 0]) spoke(spool_hole / 2 - bearing_od / 2, 4, 3);
