import { defineParams, type ParamValues } from "tscad"
export const params = defineParams({
  corner: { type: "choice", options: ["open", "closed", "overlap"], default: "closed" },
  relief: { type: "choice", options: ["none", "rect", "round", "tear"], default: "none" },
  flat: { type: "boolean", default: false },
})
export default function Tray(p: ParamValues<typeof params>) {
  const cr = p.relief === "none" ? undefined : (p.relief as any)
  return (
    <part name="tray">
      <sheetMetal name="tray" thickness={2} bendRadius={2} flat={p.flat}>
        <flange>
          <rect w={100} h={60} />
          <edgeFlange edge="+x" length={20} corner={p.corner as any} cornerRelief={cr} />
          <edgeFlange edge="+y" length={20} corner={p.corner as any} cornerRelief={cr} />
          <edgeFlange edge="-x" length={20} corner={p.corner as any} cornerRelief={cr} />
          <edgeFlange edge="-y" length={20} corner={p.corner as any} cornerRelief={cr} />
        </flange>
      </sheetMetal>
    </part>
  )
}
