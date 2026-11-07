"""Review fixture: type dispatch and construction tie policy to implementations."""
class Air: pass
class Ground: pass
class Sea: pass


class Dispatcher:
    def deliver(self, transport):
        if isinstance(transport, Air):
            return Ground()
        if isinstance(transport, Ground):
            return Sea()
        if isinstance(transport, Sea):
            return Air()


class InjectedDispatcher:
    def __init__(self, transport):
        self.transport = transport

    def deliver(self, parcel):
        return self.transport.deliver(parcel)
