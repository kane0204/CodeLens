"""Code-smell rule snippets (SRS FR-14): positive and negative cases.

Naming convention: functions/classes carrying ``positive`` must trigger their
rule; those carrying ``negative`` must not trigger any rule in this file.
The long-function positive also lives in the sample project
``projects/ai_generated_shop/reporting.py::generate_report`` (51 statements)
so the end-to-end report has one as well.
"""


def short_negative(a, b):
    """Negative: small and simple."""
    return a + b


def flat_negative(values):
    """Negative: no nesting beyond depth 1."""
    total = 0
    for v in values:
        total += v
    return total


def distinct_negative_a(records):
    """Negative: not a duplicate of distinct_negative_b."""
    return [r.id for r in records]


def distinct_negative_b(records):
    """Negative: not a duplicate of distinct_negative_a."""
    return {r.id: r.name for r in records}


def deep_nesting_positive(matrix):
    """Positive: nesting depth 5 (threshold >4)."""
    total = 0
    for row in matrix:
        for cell in row:
            if cell > 0:
                if cell % 2 == 0:
                    if cell < 100:
                        total += cell
    return total


def long_params_positive(a, b, c, d, e, f):
    """Positive: 6 parameters (threshold >4)."""
    return a + b + c + d + e + f


def distinct_negative_c(rows):
    """Negative: not a duplicate of distinct_negative_d."""
    return sum(r.value for r in rows)


def distinct_negative_d(rows):
    """Negative: not a duplicate of distinct_negative_c."""
    return max(r.value for r in rows if r.value > 0)


def deep_nesting_positive_b(cube):
    """Positive: second deep-nesting case, depth 5 via while loops."""
    count = 0
    i = 0
    while i < len(cube):
        j = 0
        while j < len(cube[i]):
            if cube[i][j] is not None:
                if cube[i][j] > 0:
                    if cube[i][j] % 2 == 1:
                        count += 1
            j += 1
        i += 1
    return count


def duplicate_positive_a(values):
    """Positive: token-level duplicate of duplicate_positive_b."""
    result = []
    for v in values:
        if v % 2 == 0:
            result.append(v * 2)
    return result


def duplicate_positive_b(items):
    """Positive: token-level duplicate of duplicate_positive_a."""
    output = []
    for i in items:
        if i % 2 == 0:
            output.append(i * 2)
    return output


def long_function_positive(rows):
    """Positive: body exceeds 50 statements (default long-function threshold)."""
    kept = []
    dropped = 0
    total = 0
    weighted = 0.0
    buckets = {}
    for row in rows:
        total += 1
        if row is None:
            dropped += 1
            continue
        if not row.active:
            dropped += 1
            continue
        if row.value < 0:
            dropped += 1
            continue
        kept.append(row)
        weighted += row.value * row.weight
        key = row.group
        if key in buckets:
            buckets[key] += 1
        else:
            buckets[key] = 1
    means = {}
    for key in buckets:
        means[key] = buckets[key] / total
    ranked = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    summary = []
    for key, count in ranked:
        summary.append((key, count, means[key]))
    lines = []
    for key, count, mean in summary:
        lines.append(f"{key}: {count} ({mean:.2f})")
    text = "\n".join(lines)
    validated = []
    for line in lines:
        if ":" in line:
            validated.append(line)
    if not validated:
        return None
    header = "group: count (mean)"
    body = "\n".join(validated)
    footer = f"rows={total} kept={len(kept)} dropped={dropped}"
    document = "\n".join([header, body, footer])
    checksum = 0
    for ch in document:
        checksum += ord(ch)
    meta = {"checksum": checksum, "lines": len(validated)}
    report = {
        "total": total,
        "kept": len(kept),
        "dropped": dropped,
        "weighted": weighted,
        "buckets": buckets,
        "summary": text,
    }
    report["document"] = document
    report["meta"] = meta
    return report


class SmallClassNegative:
    """Negative: few methods, single field group."""

    def __init__(self):
        self.a = 1

    def get_a(self):
        """Return the stored value."""
        return self.a


class GodClassPositive:
    """Positive: 12 methods and 3 field groups in one class (WMC over threshold)."""

    def __init__(self):
        self.a = 1
        self.b = 2
        self.c = 3

    def m01(self):
        return self.a

    def m02(self):
        return self.b

    def m03(self):
        return self.c

    def m04(self):
        return self.a + self.b

    def m05(self):
        return self.b + self.c

    def m06(self):
        return self.a + self.c

    def m07(self):
        return self.a * 2

    def m08(self):
        return self.b * 2

    def m09(self):
        return self.c * 2

    def m10(self):
        return self.a - self.b

    def m11(self):
        return self.b - self.c

    def m12(self):
        return self.c - self.a


class GodClassPositiveB:
    """Positive: second large-class case (10 methods, 2 field groups)."""

    def __init__(self):
        self.p = 1
        self.q = 2

    def n01(self):
        return self.p

    def n02(self):
        return self.q

    def n03(self):
        return self.p + self.q

    def n04(self):
        return self.p - self.q

    def n05(self):
        return self.p * self.q

    def n06(self):
        return self.q - self.p

    def n07(self):
        return self.p ** 2

    def n08(self):
        return self.q ** 2

    def n09(self):
        return self.p + self.q * 2

    def n10(self):
        return self.q + self.p * 2


def long_function_positive_b(events):
    """Positive: second long-function case, over 50 statements."""
    started = []
    finished = []
    failed = []
    durations = {}
    for event in events:
        name = event.name
        if name not in durations:
            durations[name] = []
        if event.kind == "start":
            started.append(name)
        elif event.kind == "finish":
            finished.append(name)
            durations[name].append(event.elapsed)
        elif event.kind == "fail":
            failed.append(name)
        else:
            continue
    totals = {}
    for name in durations:
        values = durations[name]
        if not values:
            totals[name] = 0.0
            continue
        subtotal = 0.0
        for value in values:
            subtotal += value
        totals[name] = subtotal / len(values)
    slowest = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    top = slowest[:3]
    lines = []
    for name, average in top:
        lines.append(f"{name}: {average:.2f}")
    counts = {}
    for event in events:
        key = event.kind
        if key in counts:
            counts[key] += 1
        else:
            counts[key] = 1
    shares = {}
    total_events = len(events)
    for key in counts:
        if total_events > 0:
            shares[key] = counts[key] / total_events
        else:
            shares[key] = 0.0
    ranked_shares = sorted(shares.items(), key=lambda kv: kv[1], reverse=True)
    share_lines = []
    for key, share in ranked_shares:
        share_lines.append(f"{key}: {share:.2f}")
    summary = {
        "started": len(started),
        "finished": len(finished),
        "failed": len(failed),
        "top": top,
        "text": "\n".join(lines),
        "counts": counts,
        "shares": "\n".join(share_lines),
    }
    flags = []
    if summary["failed"] > 0:
        flags.append("has_failures")
    if summary["started"] != summary["finished"]:
        flags.append("unbalanced")
    if not flags:
        flags.append("clean")
    return summary, flags
