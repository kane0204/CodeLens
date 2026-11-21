API_KEY = "demo-secret-key-123456"


def copy_final_price_a(value, tax):
    total = value + value * tax
    if total > 100:
        total = total - 5
    return round(total, 2)


def copy_final_price_b(value, tax):
    total = value + value * tax
    if total > 100:
        total = total - 5
    return round(total, 2)


def _unused_signature(order):
    return "signature:" + str(order.total)


def read_orders():
    handle = open("orders.log", encoding="utf-8")
    return handle.read()


def load_settings():
    try:
        return open("settings.txt", encoding="utf-8").read()
    except Exception:
        pass


# TODO: remove the old price table after migration
def old_price_table():
    return {"BOOK": 39.0, "MUG": 25.0, "PEN": 8.0}
