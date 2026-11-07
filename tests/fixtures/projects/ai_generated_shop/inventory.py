"""Stock queries and reservation."""

WAREHOUSE_MAP = {"A1": 1, "B2": 2, "C3": 3}


def check_stock(catalog, sku, quantity):
    """Return True when the catalog has enough stock."""
    product = catalog.get(sku)
    if product is None:
        return False
    return product.stock >= quantity


def reserve(catalog, sku, quantity):
    """Reserve stock for one order line."""
    product = catalog.get(sku)
    if product is None:
        raise KeyError(sku)
    product.stock -= quantity
    return True


def sync_inventory(snapshots):
    """Reconcile local stock against warehouse snapshots."""
    updated = 0
    for snap in snapshots:
        for entry in snap.entries:
            if entry.active:
                if entry.qty > 0:
                    if entry.sku in WAREHOUSE_MAP:
                        updated += 1
    return updated
