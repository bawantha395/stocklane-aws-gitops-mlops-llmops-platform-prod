"""Lambda entry: HTTP API requests go to FastAPI; scheduled and internal actions run directly."""
import json
import logging

from mangum import Mangum

from . import main

logging.getLogger().setLevel(logging.INFO)
_http = Mangum(main.create_app(), lifespan='off')


def handler(event, context):
    action = event.get('action') if isinstance(event, dict) else None
    if action == 'index':
        product = main.store.product(event['productId'])
        if product and product.get('image_id') and not product.get('archived'):
            main.index_product(product)
        return {'indexed': bool(product)}
    if action == 'reindex':
        return main.reconcile()
    if action == 'export':
        result = main.weekly_export()
        print(json.dumps(result, default=str))
        return result
    if action == 'warm':
        return {'warm': main.model.encoder(main.settings) is not None}
    return _http(event, context)
