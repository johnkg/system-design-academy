/** Top-level groups of the catalog. Order here is the order on the home page. */
export const areas = [
  { id: 'scaling', label: 'Scaling & infrastructure', blurb: 'How systems grow and stay fast under load' },
  { id: 'data', label: 'Data & consistency', blurb: 'How data is stored, copied and kept correct' },
  { id: 'messaging', label: 'Messaging & async', blurb: 'How parts of a system talk without waiting' },
  { id: 'reliability', label: 'Reliability & resilience', blurb: 'How systems survive failures and overload' },
  { id: 'api', label: 'API design', blurb: 'How services expose, protect and evolve their interfaces' },
  { id: 'security', label: 'Security', blurb: 'How systems keep data and users safe from attackers' },
  { id: 'observability', label: 'Observability', blurb: 'How you see what a running system is doing, and know when it is unhealthy' },
  { id: 'networking', label: 'Networking', blurb: 'How data travels between machines, and what it costs in time' },
  { id: 'distributed', label: 'Distributed systems', blurb: 'How many machines agree, stay in step and survive failures together' },
  { id: 'deployment', label: 'Cloud & deployment', blurb: 'How code reaches production safely, and how infrastructure grows, heals and survives a region failing' },
  { id: 'databases', label: 'Databases & storage', blurb: 'How a database stores, protects, queries and changes your data underneath the SQL' },
  { id: 'dataengineering', label: 'Data engineering', blurb: 'How data is moved, transformed and kept trustworthy at scale, in batches and in streams' },
  { id: 'aiml', label: 'AI & ML systems', blurb: 'How models are served, fed with context, evaluated and kept safe in production, and how the machines that train them are used' },
  { id: 'search', label: 'Search systems', blurb: 'How text is indexed, ranked, spread over machines, kept fresh and judged, from the first keystroke to the last result' },
  { id: 'payments', label: 'Payments & money', blurb: 'How money is represented, recorded, moved and checked, so that every cent can be accounted for' },
  { id: 'mobile', label: 'Mobile & offline', blurb: 'How apps keep working on slow, flaky or missing connections, and on versions you cannot update' },
  { id: 'principles', label: 'Design principles', blurb: 'The rules of thumb that keep code easy to change, SOLID included, and the ways each one is most often misunderstood' },
  { id: 'algorithms', label: 'Algorithms & complexity', blurb: 'How the cost of code grows with its input, and the hidden costs that turn a harmless-looking loop into an outage' },
  { id: 'concurrency', label: 'Concurrency & parallelism', blurb: 'How code that runs at the same time shares data safely, and the bugs that appear when it does not' },
  { id: 'testing', label: 'Testing & quality', blurb: 'How to know that code works, what each kind of test can and cannot tell you, and why tests lie' },
  { id: 'patterns', label: 'Design patterns', blurb: 'The 23 classic Gang of Four patterns for structuring code' },
] as const;

export const areaLabel = (id: string) => areas.find((a) => a.id === id)?.label ?? id;
