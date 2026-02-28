import { connect } from "framer-api"

export default async function handler(req, res) {
  try {
    const secret = req.query.secret
    if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const supabaseId = req.query.id
    if (!supabaseId) return res.status(400).json({ error: "Missing ?id=" })

    // --- 1) SUPABASE FETCH (with clear errors)
    const supaUrl =
      `${process.env.SUPABASE_URL}/rest/v1/sync_test` +
      `?select=name&id=eq.${encodeURIComponent(supabaseId)}&limit=1`

    let supaRes
    try {
      supaRes = await fetch(supaUrl, {
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
        },
      })
    } catch (e) {
      console.error("SUPABASE NETWORK ERROR:", e)
      return res.status(500).json({ stage: "supabase_network", error: String(e) })
    }

    if (!supaRes.ok) {
      const details = await supaRes.text()
      console.error("SUPABASE HTTP ERROR:", supaRes.status, details)
      return res.status(500).json({ stage: "supabase_http", status: supaRes.status, details })
    }

    const supaData = await supaRes.json()
    const newName = supaData?.[0]?.name
    if (!newName) return res.status(404).json({ stage: "supabase_data", error: "No row for that id" })

    // --- 2) FRAMER CONNECT (with clear errors)
    let framer
    try {
      framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
    } catch (e) {
      console.error("FRAMER CONNECT ERROR:", e)
      return res.status(500).json({ stage: "framer_connect", error: String(e) })
    }

    // --- 3) UPDATE CMS (with clear errors)
    try {
      const collections = await framer.getCollections()
      const providers = collections.find((c) => c.name === "Service Providers")
      if (!providers) {
        framer.disconnect()
        return res.status(404).json({ stage: "framer_collections", error: 'Collection "Service Providers" not found' })
      }

      const fields = await providers.getFields()
      const nameField = fields.find((f) => f.name === "Name")
      const supabaseIdField = fields.find((f) => f.name === "supabase_id")

      if (!nameField || !supabaseIdField) {
        framer.disconnect()
        return res.status(500).json({
          stage: "framer_fields",
          error: "Missing Name or supabase_id field",
          fieldsFound: fields.map((f) => f.name),
        })
      }

      const items = await providers.getItems()
      const item = items.find((it) => it.fieldData?.[supabaseIdField.id] === supabaseId)

      if (!item) {
        framer.disconnect()
        return res.status(404).json({ stage: "framer_items", error: "No CMS item has that supabase_id" })
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
    } catch (e) {
      console.error("FRAMER CMS ERROR:", e)
      try { framer?.disconnect?.() } catch {}
      return res.status(500).json({ stage: "framer_cms", error: String(e) })
    }
  } catch (e) {
    console.error("TOP LEVEL ERROR:", e)
    return res.status(500).json({ stage: "top_level", error: String(e) })
  }
}
