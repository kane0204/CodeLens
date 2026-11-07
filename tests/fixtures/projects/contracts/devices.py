"""Review fixture: a read-only device is forced to expose a writer contract."""
class Device:
    def read(self, size=64):
        return bytes(size)

    def write(self, data):
        return len(data)


class ReadOnlyDevice(Device):
    def read(self, size):
        return bytes(size)

    def write(self, data):
        raise NotImplementedError("read-only device")


class CompatibleDevice(Device):
    def read(self, size=64, *, encoding=None):
        return bytes(size)
