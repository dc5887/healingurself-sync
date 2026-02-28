import { connect } from "framer-api"

export default async function handler(req, res) {
  try {
    const secret = req.query.secret
    if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const supabaseId = req.query.id
    if (!supabaseId) return res.status(400).json({ error: "Missing ?id=" })

    const supaUrl =
      `${process.env.SUPABASE_URL}/rest/v1/sync_test` +
      `?select=name&id=eq.${encodeURIComponent(supabaseId)}&limit=1`

    const supaRes = await fetch(supaUrl, {
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      },
    })

    if (!supaRes.ok) {
      const details = await supaRes.text()
      return res.status(500).json({ error: "Supabase fetch failed", details })
    }

    const supaData = await supaRes.json()
    const newName = supaData?.[0]?.name
    if (!newName) return res.status(404).json({ error: "No Supabase row found for that id" })

    const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)

    const collections = await framer.getCollections()
    const providers = collections.find((c) => c.name === "Service Providers")
    if (!providers) {
      framer.disconnect()
      return res.status(404).json({ error: 'Collection "Service Providers" not found' })
    }

    const fields = await providers.getFields()
    const nameField = fields.find((f) => f.name === "Name")
    const supabaseIdField = fields.find((f) => f.name === "supabase_id")

    if (!nameField || !supabaseIdField) {
      framer.disconnect()
      return res.status(500).json({ error: "Missing fields", fieldsFound: fields.map((f) => f.name) })
    }

    const items = await providers.getItems()
    const item = items.find((it) => it.fieldData?.[supabaseIdField.id] === supabaseId)
    if (!item) {
      framer.disconnect()
      return res.status(404).json({ error: "No Framer item found with that supabase_id" })
    }

    await providers.addItems([
      {
        id: item.id,
        slug: item.slug,
        fieldData: {
          [nameField.id]: { type: "string", value: newName },
        },
      },
    ])

    framer.disconnect()
    return res.status(200).json({ ok: true, updatedName: newName })
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
}
