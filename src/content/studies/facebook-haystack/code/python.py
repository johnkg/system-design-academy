# A miniature of Haystack from Facebook's "Needle in a haystack: efficient storage of billions of photos" (2009), in Python
# (a teaching model, not Facebook's code): photos are needles appended to one big store file, an in-memory index maps a photo and
# size to the needle's offset so a read costs one disk I/O, a delete only sets a flag, compaction copies the live needles into
# a new store file, and a restarted server rebuilds its index from the store. Everything is deterministic.

SIZES = {"large": 100, "medium": 40, "small": 20, "thumb": 8}  # bytes of image data per size (made up)
HEADER, FOOTER = 16, 8  # bytes of needle overhead (made up)
store = []  # the append-only store file: needles in the order they were written
index = {}  # in memory: "photo/size" -> offset of the needle in the store file
state = {"bytes": 0, "disk_reads": 0}
NFS_READS = 3  # directory lookup, inode read and data read when the metadata is not cached (a simple assumption)


def put(photo, size):
    needle = {"photo": photo, "size": size, "length": SIZES[size], "deleted": False, "offset": state["bytes"]}
    state["bytes"] += HEADER + needle["length"] + FOOTER
    store.append(needle)
    index[f"{photo}/{size}"] = needle["offset"]


def read(photo, size):
    offset = index.get(f"{photo}/{size}")
    if offset is None:
        return f"photo {photo} {size}: not found (the index answered, no disk read)"
    state["disk_reads"] += 1  # one read of the needle at a known offset
    needle = next(n for n in store if n["offset"] == offset)
    return f"photo {photo} {size}: {needle['length']} bytes from offset {offset} (1 disk read)"


for photo in [1, 2, 3]:
    for size in SIZES:
        put(photo, size)
print(f"uploaded 3 photos in 4 sizes: {len(store)} needles, store file {state['bytes']} bytes, index entries {len(index)}")
print(read(2, "medium"))
print(f"without an in-memory index a file-per-photo layout needs about {NFS_READS} disk reads for the same photo")
for _ in range(100):
    read(3, "thumb")
print(f"100 thumbnail reads: {state['disk_reads'] - 1} disk reads, against about {100 * NFS_READS} in the file-per-photo layout")

for size in SIZES:  # delete photo 2: set the flag and drop it from the index; the bytes stay in the file
    for n in store:
        if n["photo"] == 2 and n["size"] == size:
            n["deleted"] = True
    index.pop(f"2/{size}", None)
print(read(2, "medium"))
print(f"after the delete the store file is still {state['bytes']} bytes, with {sum(1 for n in store if n['deleted'])} flagged needles")

index = {}
for n in store:
    if not n["deleted"]:
        index[f"{n['photo']}/{n['size']}"] = n["offset"]  # after a restart the index is rebuilt from the store
print(f"restart: index rebuilt from the store file with {len(index)} live entries")

live = [n for n in store if not n["deleted"]]
store = []
state["bytes"] = 0
index = {}
for n in live:
    put(n["photo"], n["size"])  # compaction: copy live needles into a new store file
print(f"compaction: new store file {state['bytes']} bytes with {len(store)} needles")
print(read(3, "thumb"))
