/** The playground's file names. */

/** The file the editor compiles (source maps and sketch edits refer to it). */
export const MODEL_FILE = "model.tsx";

/**
 * The name shown in the top bar and given to downloads (STL, 3MF, PNG...): the open example's
 * (`cookbook/gear-pair` → `gear-pair.tsx`), else `model.tsx` for custom code.
 */
export function displayFile(example: string | undefined): string {
  return example ? `${example.split("/").pop()}.tsx` : MODEL_FILE;
}
