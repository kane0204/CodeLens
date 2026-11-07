"""Payment gateway integration."""

import thirdparty_gateway as gateway


def charge(order, card_token):
    """Charge the customer's card and return the transaction id."""
    amount = order.total
    result = gateway.pay(card_token, amount)
    return result["transaction_id"]
