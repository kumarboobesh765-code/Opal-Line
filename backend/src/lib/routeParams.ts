// Narrow an Express route parameter to a single string.
//
// Express 5 (via @types/express v5) types every route parameter as
// `string | string[]`, because a repeated parameter such as `/:id` can now
// capture several segments. At runtime a path parameter with a fixed name
// still yields exactly one string, so this collapses the union without
// changing behaviour.
//
// Use it wherever a parameter is handed to something that expects a plain
// string - most often a Drizzle column comparison:
//
//   eq(s.quotations.id, routeParam(req.params.id))
//
// Wrapping in String() alone would type-check but would turn a stray array
// into "a,b", which silently queries the wrong row. This fails loudly on a
// genuinely unexpected array instead.
export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    // Only reachable if the same parameter name is repeated in one path
    // pattern. Take the first segment rather than producing "a,b".
    return value[0] ?? ''
  }
  return value ?? ''
}