/**
 * Parameters: a typed schema that drives the viewer's sliders, the CLI's `--param` flags, and
 * the component's props (`ParamValues<typeof params>`).
 */

interface ParamBase<T> {
  /** The value when nothing overrides it. */
  default: T;
  /** Display name (default: the key, humanised). */
  label?: string;
  /** Help text shown as a tooltip. */
  description?: string;
  /** Group heading in the param panel. */
  group?: string;
}

/** A real number (slider + box). */
export interface NumberParam extends ParamBase<number> {
  type: "number";
  /** Smallest allowed value (values are clamped). */
  min?: number;
  /** Largest allowed value (values are clamped). */
  max?: number;
  /** Slider step. */
  step?: number;
  /** Unit shown next to the value, e.g. `"mm"` or `"°"`. */
  unit?: string;
}
/** A whole number (rounded, then clamped). */
export interface IntParam extends ParamBase<number> {
  type: "int";
  min?: number;
  max?: number;
  /** Slider step (default 1). */
  step?: number;
  unit?: string;
}
/** A checkbox. */
export interface BooleanParam extends ParamBase<boolean> {
  type: "boolean";
}
/** A choice from fixed options (a select); `ParamValues` infers the literal union. */
export interface ChoiceParam<O extends string | number = string | number> extends ParamBase<O> {
  type: "choice";
  /** The allowed values. */
  options: readonly O[];
  /** Display labels per option. */
  optionLabels?: Partial<Record<O & PropertyKey, string>>;
}
/** Free text (e.g. an engraving). */
export interface TextParam extends ParamBase<string> {
  type: "text";
  /** Longest allowed length (longer is truncated). */
  maxLength?: number;
}
/** A CSS colour (colour picker). */
export interface ColorParam extends ParamBase<string> {
  type: "color";
}

export type ParamSpec = NumberParam | IntParam | BooleanParam | ChoiceParam<any> | TextParam | ColorParam;
/** A model's parameters: name → spec. */
export type ParamSchema = Record<string, ParamSpec>;

/** The value type a spec produces. */
export type ParamValue<S extends ParamSpec> = S extends { type: "choice"; options: readonly (infer O)[] }
  ? O
  : S extends { type: "number" | "int" }
    ? number
    : S extends { type: "boolean" }
      ? boolean
      : string;

/** The props a model component receives: `ParamValues<typeof params>`. */
export type ParamValues<S extends ParamSchema> = { -readonly [K in keyof S]: ParamValue<S[K]> };

/**
 * Declare a model's parameters. Returns the schema unchanged, but typed precisely so that
 * `ParamValues<typeof params>` infers each value (choices as literal unions).
 *
 * @example
 * export const params = defineParams({
 *   width: { type: "number", default: 40, min: 10, max: 120, unit: "mm" },
 *   style: { type: "choice", default: "round", options: ["round", "square"] },
 * })
 * export default function Model(p: ParamValues<typeof params>) { ... } // p.style: "round" | "square"
 */
export function defineParams<const S extends ParamSchema>(schema: S & ValidateChoices<S>): S {
  for (const [k, spec] of Object.entries(schema)) checkSpec(k, spec);
  return schema;
}

/** Ensures each choice's default is one of its options (at the type level). */
type ValidateChoices<S> = {
  [K in keyof S]: S[K] extends { type: "choice"; options: readonly (infer O)[] } ? { default: O } : unknown;
};

function checkSpec(key: string, spec: ParamSpec): void {
  const bad = (m: string) => {
    throw new TypeError(`param "${key}": ${m}`);
  };
  if (!spec || typeof spec !== "object") bad("spec must be an object");
  switch (spec.type) {
    case "number":
    case "int":
      if (typeof spec.default !== "number" || !Number.isFinite(spec.default)) bad("default must be a finite number");
      if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) bad(`min (${spec.min}) > max (${spec.max})`);
      break;
    case "boolean":
      if (typeof spec.default !== "boolean") bad("default must be a boolean");
      break;
    case "choice":
      if (!Array.isArray(spec.options) || spec.options.length === 0) bad("options must be a non-empty array");
      if (!spec.options.includes(spec.default)) bad(`default ${JSON.stringify(spec.default)} is not one of the options`);
      break;
    case "text":
    case "color":
      if (typeof spec.default !== "string") bad("default must be a string");
      break;
    default:
      bad(`unknown type ${JSON.stringify((spec as { type: unknown }).type)}`);
  }
}

/** The defaults of every param. */
export function paramDefaults<S extends ParamSchema>(schema: S): ParamValues<S> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema)) out[k] = s.default;
  return out as ParamValues<S>;
}

/** A value that was changed to fit its spec. */
export interface ParamIssue {
  key: string;
  message: string;
  given: unknown;
  used: unknown;
}

/**
 * Merge `overrides` onto the defaults, coercing strings (from URLs / CLI flags) and clamping
 * to each spec. Unknown keys are reported as issues and dropped.
 */
export function resolveParams<S extends ParamSchema>(schema: S, overrides: Record<string, unknown> = {}): { values: ParamValues<S>; issues: ParamIssue[] } {
  const values: Record<string, unknown> = paramDefaults(schema);
  const issues: ParamIssue[] = [];
  for (const [key, given] of Object.entries(overrides)) {
    if (given === undefined) continue;
    const spec = schema[key];
    if (!spec) {
      issues.push({ key, message: `unknown param "${key}"`, given, used: undefined });
      continue;
    }
    const { value, message } = coerce(spec, given);
    if (message) issues.push({ key, message, given, used: value });
    values[key] = value;
  }
  return { values: values as ParamValues<S>, issues };
}

/** Coerce and clamp one value to its spec. */
export function coerce(spec: ParamSpec, given: unknown): { value: unknown; message?: string } {
  switch (spec.type) {
    case "number":
    case "int": {
      let v = typeof given === "string" ? Number(given.trim()) : typeof given === "number" ? given : NaN;
      if (!Number.isFinite(v)) return { value: spec.default, message: `${JSON.stringify(given)} is not a number; using the default` };
      let msg: string | undefined;
      if (spec.type === "int" && !Number.isInteger(v)) {
        v = Math.round(v);
        msg = `rounded to ${v}`;
      }
      if (spec.min !== undefined && v < spec.min) return { value: spec.min, message: `${v} is below the minimum; clamped to ${spec.min}` };
      if (spec.max !== undefined && v > spec.max) return { value: spec.max, message: `${v} is above the maximum; clamped to ${spec.max}` };
      return msg ? { value: v, message: msg } : { value: v };
    }
    case "boolean": {
      if (typeof given === "boolean") return { value: given };
      if (given === "true" || given === "1" || given === 1 || given === "yes" || given === "on") return { value: true };
      if (given === "false" || given === "0" || given === 0 || given === "no" || given === "off" || given === "") return { value: false };
      return { value: spec.default, message: `${JSON.stringify(given)} is not a boolean; using the default` };
    }
    case "choice": {
      if (spec.options.includes(given)) return { value: given };
      const loose = spec.options.find((o: unknown) => String(o) === String(given));
      if (loose !== undefined) return { value: loose };
      return { value: spec.default, message: `${JSON.stringify(given)} is not one of ${spec.options.map((o: unknown) => JSON.stringify(o)).join(", ")}; using the default` };
    }
    case "text": {
      const s = String(given);
      if (spec.maxLength !== undefined && s.length > spec.maxLength) return { value: s.slice(0, spec.maxLength), message: `truncated to ${spec.maxLength} characters` };
      return { value: s };
    }
    case "color":
      return { value: String(given) };
  }
}

/** Display label of a param: its `label`, or the key humanised (`wallThickness` → "Wall thickness"). */
export function paramLabel(key: string, spec: ParamSpec): string {
  if (spec.label) return spec.label;
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
