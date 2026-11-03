// A teaching model of the read path described in the Bigtable paper. Writes go to a memtable that is flushed to a new SSTable
// each time it fills, so a tablet collects files, and a read may have to look in several. Compactions, Bloom filters and the
// block size are how Bigtable keeps that cheap. It is not Google's code or data: where the paper gives a figure it is used and
// named below, and the rest are round teaching numbers. Kept apart from the page so plain Node can import it in unit tests.

export interface Params {
  /** Writes the tablet has taken since it was created. */
  writes: number;
  /** Merging compactions in the background keep the number of SSTables bounded. */
  compactions: boolean;
  /** A Bloom filter per SSTable says whether the file might hold a row, so most lookups for missing data skip the disk. */
  bloomFilters: boolean;
  /** Size of an SSTable block in kilobytes. */
  blockKb: number;
  /** Whether the row being read exists. */
  rowExists: boolean;
}
export interface Result {
  sstables: number;
  /** Expected disk seeks for one random read of this row. */
  seeksPerRead: number;
  /** Data pulled from the file system per read, in kilobytes. */
  kbPerRead: number;
  /** Random reads one tablet server can do each second. */
  readsPerSecond: number;
}

export const MEMTABLE_FLUSH_ENTRIES = 1_000; // writes that fill a memtable (a teaching figure)
export const MAX_SSTABLES_WITH_COMPACTIONS = 5; // files merging compactions keep a tablet at or under (a teaching figure)
export const BLOOM_FALSE_POSITIVE = 0.01; // the share of lookups a filter wrongly lets through (a teaching figure)
export const FILE_SYSTEM_MB_PER_SECOND = 75; // the paper: about 75 MB/s read from GFS by one tablet server doing random reads
export const CPU_LIMIT_READS_PER_SECOND = 10_811; // the paper: random reads served from memory by one tablet server
const KB_PER_MB = 1000;

export function simulate(p: Params): Result {
  const flushes = Math.floor(p.writes / MEMTABLE_FLUSH_ENTRIES);
  const sstables = p.compactions ? Math.min(flushes, MAX_SSTABLES_WITH_COMPACTIONS) : flushes;
  // A row that exists is in one file, and a read looks through them in turn until it finds it: half of them on average, and
  // the one it needs. A row that does not exist is looked for in every file. A Bloom filter turns each file that does not
  // hold the row into a seek only now and then.
  let seeks: number;
  if (p.bloomFilters) seeks = p.rowExists ? 1 + (sstables - 1) * BLOOM_FALSE_POSITIVE : sstables * BLOOM_FALSE_POSITIVE;
  else seeks = p.rowExists ? (sstables + 1) / 2 : sstables;
  if (sstables === 0) seeks = 0;
  const kbPerRead = seeks * p.blockKb;
  const bandwidthLimited = kbPerRead > 0 ? (FILE_SYSTEM_MB_PER_SECOND * KB_PER_MB) / kbPerRead : Infinity;
  return { sstables, seeksPerRead: seeks, kbPerRead, readsPerSecond: Math.min(bandwidthLimited, CPU_LIMIT_READS_PER_SECOND) };
}
