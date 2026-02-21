# Operation Recipes

## Add a card

```json
{
  "type": "farm_action",
  "action": "ha_canvas_patch_spec",
  "params": {
    "operations": [
      {
        "op": "add_card",
        "card": {
          "id": "energy-kpi",
          "type": "kpi",
          "title": "Solar Generation",
          "entities": ["input_number.solar_generation_kw"],
          "options": { "suffix": " kW", "decimals": 0 }
        }
      }
    ]
  },
  "requestId": "act_canvas_add_001"
}
```

## Move a card

```json
{
  "type": "farm_action",
  "action": "ha_canvas_patch_spec",
  "params": {
    "operations": [
      { "op": "move_card", "cardId": "energy-kpi", "toIndex": 0 }
    ]
  },
  "requestId": "act_canvas_move_001"
}
```

## Patch staged dashboard card

```json
{
  "type": "farm_action",
  "action": "ha_dashboard_patch",
  "params": {
    "dashboardFile": "/workspace/dashboard/ui-lovelace-staging.yaml",
    "operations": [
      {
        "op": "update_card",
        "viewPath": "command-center",
        "cardId": "water-overview",
        "patch": { "title": "Water Operations" }
      }
    ]
  },
  "requestId": "act_dash_patch_001"
}
```
