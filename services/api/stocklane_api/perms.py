"""Who may do what. Four roles (Cognito groups); the owner decides, per shop, what the other three may do.

OWNER can always do everything. ADMIN, STOREKEEPER and MECHANIC start from the defaults below; the owner ticks boxes on the
Permissions screen and the choice is stored in the shop's own rows. A person in two roles gets both sets. Every route names
the one permission it needs, so the screen and the server can never disagree.
"""
from .core import ApiError, PerShop, bad, command, get, groups, now, put

ROLES = ('OWNER', 'ADMIN', 'STOREKEEPER', 'MECHANIC')
EDITABLE = ('ADMIN', 'STOREKEEPER', 'MECHANIC')

# key, section, what it lets a person do (shown on the Permissions screen)
PERMISSIONS = (
    ('jobs_view', 'Workshop', 'See jobs and vehicles'),
    ('jobs', 'Workshop', 'Open and edit job cards'),
    ('quotes', 'Workshop', 'Write estimates'),
    ('quotes_approve', 'Workshop', 'Approve, convert and delete estimates'),
    ('vehicles', 'Workshop', 'Edit vehicle and customer details'),
    ('customers_view', 'Workshop', 'See the customer list, their history and statements'),
    ('customers_edit', 'Workshop', 'Edit, merge and close customer records'),
    ('bills_view', 'Workshop', 'See bills'),
    ('bill', 'Workshop', 'Make bills and take payments'),
    ('void_refund', 'Workshop', 'Void bills, refunds and returns'),
    ('archive', 'Workshop', 'Cancel, delete and restore jobs'),
    ('job_stock', 'Stock', 'Put stock parts on a job'),
    ('stock_in', 'Stock', 'Record parts that came in (GRN)'),
    ('stock_out', 'Stock', 'Record parts that went out (GIN)'),
    ('stock_count', 'Stock', 'Correct stock from a shelf count'),
    ('item_add', 'Stock', 'Register new parts'),
    ('item_edit', 'Stock', 'Edit and archive parts'),
    ('lists', 'Stock', 'Change shelves and categories'),
    ('people', 'Stock', 'Change who can receive parts'),
    ('suppliers_view', 'Stock', 'See the supplier list and pick a supplier'),
    ('suppliers_edit', 'Stock', 'Add, edit and close suppliers'),
    ('supplier_return', 'Stock', 'Send parts back to a supplier'),
    ('orders', 'Stock', 'See the to-order list and send orders to suppliers'),
    ('see_cost', 'Money', 'See what parts cost and the margin'),
    ('price_edit', 'Money', 'Change the selling price of a part'),
    ('supplier_pay', 'Money', 'See what is owed to suppliers and record payments'),
    ('cost_edit', 'Money', 'Correct the cost on a delivery'),
    ('see_sales', 'Money', 'See sales totals on the home screen'),
    ('reports', 'Money', 'See reports'),
    ('settings', 'Business', 'Change business settings and logo'),
    ('export', 'Business', 'Download all data'),
)
KEYS = tuple(p[0] for p in PERMISSIONS)
MECHANIC = {'jobs_view', 'jobs', 'quotes', 'vehicles', 'customers_view', 'bills_view', 'bill', 'job_stock', 'stock_in', 'stock_out', 'item_add', 'suppliers_view'}
STOREKEEPER = {'jobs_view', 'job_stock', 'stock_in', 'stock_out', 'stock_count', 'item_add', 'people', 'suppliers_view', 'supplier_return', 'orders'}
DEFAULTS = {'MECHANIC': MECHANIC, 'STOREKEEPER': STOREKEEPER,
            'ADMIN': MECHANIC | STOREKEEPER | {'quotes_approve', 'archive', 'item_edit', 'lists', 'customers_edit', 'suppliers_edit', 'supplier_return', 'orders', 'price_edit'}}
_cache = PerShop(until=0, value=None)


def table():
    """role -> set of permissions for this shop (the owner's saved choice, or the defaults)."""
    import time
    if _cache['value'] is None or time.monotonic() > _cache['until']:
        saved = (get('WSET', 'permissions') or {}).get('roles') or {}
        value = {role: (set(saved[role]) & set(KEYS)) if role in saved else set(DEFAULTS[role]) for role in EDITABLE}
        _cache.update(value=value, until=time.monotonic() + 30)
    return _cache['value']


def of(event):
    """Everything this sign-in may do."""
    mine = groups(event)
    if 'OWNER' in mine:
        return set(KEYS)
    if not mine.intersection(EDITABLE):
        return set()  # (the platform owner, for one: no shop, so no table to read)
    out, roles = set(), table()
    for role in EDITABLE:
        if role in mine:
            out |= roles[role]
    return out


def can(event, permission):
    return permission in of(event)


def need(event, permission):
    if not groups(event).intersection(ROLES):
        raise ApiError(403, 'Staff access is required')
    if not can(event, permission):
        raise ApiError(403, 'Your role cannot do this. Ask the owner to allow it in Settings, Permissions.')


def view():
    roles = table()
    return {'permissions': [{'key': k, 'section': s, 'label': l} for k, s, l in PERMISSIONS],
            'roles': {r: sorted(roles[r], key=KEYS.index) for r in EDITABLE},
            'defaults': {r: sorted(DEFAULTS[r], key=KEYS.index) for r in EDITABLE}}


def save(key, who, body):
    """Owner only: the whole table. Sending {"reset": true} goes back to the defaults."""
    def build():
        b = body or {}
        if b.get('reset'):
            roles = {r: sorted(DEFAULTS[r], key=KEYS.index) for r in EDITABLE}
        else:
            given = b.get('roles')
            if not isinstance(given, dict):
                raise bad('Send the permissions of each role')
            roles = {}
            for role in EDITABLE:
                picks = given.get(role, [])
                if not isinstance(picks, list) or any(p not in KEYS for p in picks):
                    raise bad('Check the permissions of ' + role)
                roles[role] = sorted(set(picks), key=KEYS.index)
        row = {'pk': 'WSET', 'sk': 'permissions', 'roles': roles, 'updated_at': now(), 'updated_by': who}
        return [put(row)], [None], {'roles': roles}
    result = command(key, 'permissions', who, body, build)
    _cache.update(value=None, until=0)
    return dict(view(), roles=result['roles'])
