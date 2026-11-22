# A plain binary search tree against an AVL tree (a BST that rotates to stay balanced), counted in key comparisons, never in time.
# Keys are inserted in three orders: sorted, random (a fixed shuffle) and zigzag (smallest, largest, next smallest, ...).
# Look for: the plain BST on sorted or zigzag input is a list in disguise (height n, about n^2/2 comparisons); the AVL tree
# keeps its height near log2(n) on every order, and pays with a few rotations. The last lines count levels of a B-tree by fanout.
# The plain BST is built with loops (a degenerate tree is as deep as it is long); the AVL tree uses recursion, which stays shallow.


def make_keys(order, n):
    keys = []
    if order == 'sorted':
        keys = list(range(1, n + 1))
    elif order == 'zigzag':
        lo, hi = 1, n
        while lo <= hi:
            keys.append(lo)
            lo += 1
            if lo <= hi:
                keys.append(hi)
                hi -= 1
    else:
        keys = list(range(1, n + 1))
        x = 12345
        for i in range(n - 1, 0, -1):
            x = (x * 1664525 + 1013904223) % 4294967296
            j = (x >> 16) % (i + 1)
            keys[i], keys[j] = keys[j], keys[i]
    return keys


# Both trees store nodes in lists: key, left, right (-1 means no child), height for the AVL tree.
def plain_bst(keys):
    key, left, right = [], [], []
    comparisons = 0
    root = -1
    for k in keys:
        key.append(k)
        left.append(-1)
        right.append(-1)
        node_id = len(key) - 1
        if root < 0:
            root = node_id
            continue
        at = root
        while True:
            comparisons += 1
            side = left if k < key[at] else right
            if side[at] < 0:
                side[at] = node_id
                break
            at = side[at]
    height, lookups = measure(root, left, right)
    return height, lookups, comparisons, 0


def avl_tree(keys):
    key, left, right, height = [], [], [], []
    state = {'comparisons': 0, 'rotations': 0}

    def h(i):
        return 0 if i < 0 else height[i]

    def fix(i):
        height[i] = 1 + max(h(left[i]), h(right[i]))

    def rotate_right(y):
        x = left[y]
        left[y] = right[x]
        right[x] = y
        fix(y)
        fix(x)
        state['rotations'] += 1
        return x

    def rotate_left(x):
        y = right[x]
        right[x] = left[y]
        left[y] = x
        fix(x)
        fix(y)
        state['rotations'] += 1
        return y

    def insert(at, node_id):
        if at < 0:
            return node_id
        state['comparisons'] += 1
        if key[node_id] < key[at]:
            left[at] = insert(left[at], node_id)
        else:
            right[at] = insert(right[at], node_id)
        fix(at)
        balance = h(left[at]) - h(right[at])
        if balance > 1:
            if h(left[left[at]]) < h(right[left[at]]):
                left[at] = rotate_left(left[at])
            return rotate_right(at)
        if balance < -1:
            if h(right[right[at]]) < h(left[right[at]]):
                right[at] = rotate_right(right[at])
            return rotate_left(at)
        return at

    root = -1
    for k in keys:
        key.append(k)
        left.append(-1)
        right.append(-1)
        height.append(1)
        root = insert(root, len(key) - 1)
    ht, lookups = measure(root, left, right)
    return ht, lookups, state['comparisons'], state['rotations']


# Height and the sum of (depth + 1) over all nodes: looking every key up once costs exactly that many comparisons.
def measure(root, left, right):
    height = lookups = 0
    stack = [(root, 1)]
    while stack:
        node_id, depth = stack.pop()
        if node_id < 0:
            continue
        height = max(height, depth)
        lookups += depth
        stack.append((left[node_id], depth + 1))
        stack.append((right[node_id], depth + 1))
    return height, lookups


def hundredths(a, b):
    v = (a * 100) // b
    return f'{v // 100}.{v % 100:02d}'


for n in [10, 100, 1000, 10000]:
    print(f'n={n}')
    for order in ['sorted', 'zigzag', 'random']:
        keys = make_keys(order, n)
        ah, al, ac, _ = plain_bst(keys)
        bh, bl, bc, br = avl_tree(keys)
        print(f'  {order}: plain BST height {ah}, {ac} comparisons to build, {hundredths(al, n)} per lookup; '
              f'AVL height {bh}, {bc} comparisons, {br} rotations, {hundredths(bl, n)} per lookup')


def levels(n, fanout):  # smallest h such that a full tree of height h holds n keys: fanout^h - 1 >= n
    h, capacity = 0, 1
    while capacity - 1 < n:
        capacity *= fanout
        h += 1
    return h


for n in [1000000, 1000000000]:
    print(f'levels to hold {n} keys: ' + ', '.join(f'fanout {f}: {levels(n, f)}' for f in [2, 100, 500]))
