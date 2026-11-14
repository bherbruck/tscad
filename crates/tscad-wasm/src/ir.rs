//! The tscad IR ("cad-json"): what the TypeScript side compiles a TSX tree into, and what this
//! crate evaluates with solidcore. Kept in sync with `src/ir.ts`.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// A whole design: named parts, each one solid tree.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
pub struct Document {
    #[serde(default)]
    pub parts: Vec<Part>,
}

/// One part of a design.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
pub struct Part {
    #[serde(default)]
    pub name: String,
    /// Display colour, any CSS colour; the kernel ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub color: Option<String>,
    pub node: Node,
}

/// A 4x4 affine matrix, row-major, column-vector convention (p' = M p; translation in
/// elements 3, 7, 11; last row 0 0 0 1).
pub type Matrix = [f64; 16];

/// One node of the solid tree.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Node {
    /// An axis-aligned box from its lower corner (`center` puts its centre at the origin).
    Box {
        size: [f64; 3],
        #[serde(default)]
        center: bool,
    },
    /// A cylinder about +Z from its base centre (`center` centres it in Z).
    Cylinder {
        radius: f64,
        height: f64,
        #[serde(default)]
        center: bool,
    },
    /// A sphere about the origin.
    Sphere { radius: f64 },
    /// A cone or frustum about +Z.
    Cone {
        #[serde(rename = "bottomRadius")]
        bottom_radius: f64,
        #[serde(rename = "topRadius")]
        top_radius: f64,
        height: f64,
        #[serde(default)]
        center: bool,
    },
    /// A torus about +Z.
    Torus {
        #[serde(rename = "majorRadius")]
        major_radius: f64,
        #[serde(rename = "minorRadius")]
        minor_radius: f64,
    },
    /// Everything in any child.
    Union { children: Vec<Node> },
    /// The first child less every other.
    Difference { children: Vec<Node> },
    /// What every child shares.
    Intersection { children: Vec<Node> },
    /// The children (unioned) moved by `matrix`.
    Transform { matrix: Matrix, children: Vec<Node> },
    /// A closed planar profile extruded along `direction` by `distance`.
    Extrude {
        profile: Vec<Curve>,
        direction: [f64; 3],
        distance: f64,
        #[serde(default)]
        draft: f64,
    },
    /// A closed planar profile revolved about an axis.
    Revolve {
        profile: Vec<Curve>,
        origin: [f64; 3],
        axis: [f64; 3],
        angle: f64,
    },
    /// Closed planar sections skinned in order.
    Loft {
        sections: Vec<Vec<Curve>>,
        #[serde(default)]
        ruled: bool,
    },
    /// A closed planar profile swept along a path.
    Sweep {
        profile: Vec<Curve>,
        path: Vec<Curve>,
        #[serde(default)]
        frame: SweepFrame,
    },
    /// The selected edges of the children (unioned) rounded.
    Fillet {
        radius: f64,
        #[serde(default)]
        edges: Selector,
        children: Vec<Node>,
    },
    /// The selected edges of the children (unioned) chamfered.
    Chamfer {
        distance: f64,
        #[serde(default)]
        edges: Selector,
        children: Vec<Node>,
    },
    /// The children (unioned) hollowed to `thickness`, the selected faces left open.
    Shell {
        thickness: f64,
        #[serde(default = "Selector::none")]
        faces: Selector,
        children: Vec<Node>,
    },
}

/// How a swept profile moves along its path.
#[derive(Debug, Default, Serialize, Deserialize, Clone, Copy, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum SweepFrame {
    #[default]
    Follow,
    Translate,
}

/// A profile or path curve in model space.
#[derive(Debug, Serialize, Deserialize, Clone, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Curve {
    Line {
        start: [f64; 3],
        end: [f64; 3],
    },
    /// Counter-clockwise about `axis` from `start` to `end` radians, angle 0 along `reference`.
    Arc {
        center: [f64; 3],
        axis: [f64; 3],
        reference: [f64; 3],
        radius: f64,
        start: f64,
        end: f64,
    },
    Nurbs {
        degree: usize,
        points: Vec<[f64; 4]>,
        knots: Vec<f64>,
    },
}

/// Which edges or faces an operation takes.
#[derive(Debug, Serialize, Deserialize, Clone, Default, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Selector {
    /// Every one.
    #[default]
    All,
    /// None at all.
    None,
    /// Edges: straight and parallel to the axis. Faces: planar with normal along +/- the axis.
    Parallel { axis: Axis },
    /// Edges: circles about the axis. Faces: planar with normal square to the axis.
    Perpendicular { axis: Axis },
    /// Those lying wholly at the body's largest coordinate along the axis.
    Max { axis: Axis },
    /// Those lying wholly at the body's smallest coordinate along the axis.
    Min { axis: Axis },
    /// Edges: circles of this radius (within 1e-6 relative).
    Radius { radius: f64 },
    /// Those whose sample points all fall inside the box.
    Within { min: [f64; 3], max: [f64; 3] },
    /// In every one of the selectors.
    And { of: Vec<Selector> },
    /// In any of the selectors.
    Or { of: Vec<Selector> },
    /// Not in the selector.
    Not { of: Box<Selector> },
    /// Record indices, as given.
    Index { indices: Vec<usize> },
}

impl Selector {
    pub fn none() -> Self {
        Selector::None
    }
}

/// A coordinate axis.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    X,
    Y,
    Z,
}

impl Axis {
    pub fn index(self) -> usize {
        match self {
            Axis::X => 0,
            Axis::Y => 1,
            Axis::Z => 2,
        }
    }
}
