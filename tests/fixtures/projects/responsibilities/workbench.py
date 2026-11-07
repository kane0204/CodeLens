"""Review fixture: intentionally mixed persistence, presentation and auth APIs."""
class Workbench:
    def load(self): pass
    def save(self): pass
    def delete(self): pass
    def login(self): pass
    def logout(self): pass
    def authorize(self): pass
    def render(self): pass
    def print_report(self): pass
    def export_csv(self): pass
    def send_email(self): pass
    def schedule(self): pass
    def backup(self): pass
    def restore(self): pass


class Repository:
    def load(self): pass
    def save(self): pass
