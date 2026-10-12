const express = require("express");
const mysql = require("mysql2/promise");
require("dotenv").config();
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "tienda_barrio",
  waitForConnections: true,
  connectionLimit: 10
});

// Consultar productos
app.get("/api/productos", async (req, res) => {
  try {
    const [productos] = await pool.query(
      "SELECT * FROM productos ORDER BY nombre"
    );
    res.json(productos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al consultar productos" });
  }
});

// Registrar una venta y actualizar el inventario
app.post("/api/ventas", async (req, res) => {
  const idProducto = Number(req.body.id_producto);
  const cantidad = Number(req.body.cantidad);

  if (
    !Number.isInteger(idProducto) ||
    idProducto < 1 ||
    !Number.isInteger(cantidad) ||
    cantidad < 1
  ) {
    return res.status(400).json({
      error: "Selecciona un producto y una cantidad válida"
    });
  }

  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [productos] = await conexion.execute(
      `SELECT id_producto, precio, stock
       FROM productos
       WHERE id_producto = ?
       FOR UPDATE`,
      [idProducto]
    );

    if (productos.length === 0) {
      throw new Error("Producto no encontrado");
    }

    const producto = productos[0];

    if (producto.stock < cantidad) {
      throw new Error("No hay inventario suficiente");
    }

    const precio = Number(producto.precio);
    const total = Number((precio * cantidad).toFixed(2));

    const [venta] = await conexion.execute(
      "INSERT INTO ventas (total) VALUES (?)",
      [total]
    );

    await conexion.execute(
      `INSERT INTO detalle_ventas
       (id_venta, id_producto, cantidad, precio_unitario)
       VALUES (?, ?, ?, ?)`,
      [venta.insertId, idProducto, cantidad, precio]
    );

    await conexion.execute(
      `UPDATE productos
       SET stock = stock - ?
       WHERE id_producto = ?`,
      [cantidad, idProducto]
    );

    await conexion.commit();

    res.status(201).json({
      mensaje: "Venta registrada correctamente",
      id_venta: venta.insertId,
      total
    });
  } catch (error) {
    await conexion.rollback();

    const erroresValidacion = [
      "Producto no encontrado",
      "No hay inventario suficiente"
    ];

    const codigo = erroresValidacion.includes(error.message)
      ? 400
      : 500;

    if (codigo === 500) console.error(error);

    res.status(codigo).json({
      error: codigo === 400
        ? error.message
        : "Error al registrar la venta"
    });
  } finally {
    conexion.release();
  }
});

// Consultar las ventas
app.get("/api/ventas", async (req, res) => {
  try {
    const [ventas] = await pool.query(
      "SELECT id_venta, fecha, total FROM ventas ORDER BY fecha DESC"
    );
    res.json(ventas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al consultar ventas" });
  }
});

// Informe de ventas del día
app.get("/api/informes/diario", async (req, res) => {
  try {
    const [informe] = await pool.query(`
      SELECT
        p.nombre AS producto,
        SUM(d.cantidad) AS unidades_vendidas,
        SUM(d.cantidad * d.precio_unitario) AS total_vendido
      FROM ventas v
      JOIN detalle_ventas d ON v.id_venta = d.id_venta
      JOIN productos p ON d.id_producto = p.id_producto
      WHERE v.fecha >= CURDATE()
        AND v.fecha < CURDATE() + INTERVAL 1 DAY
      GROUP BY p.id_producto, p.nombre
      ORDER BY unidades_vendidas DESC
    `);

    res.json(informe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar el informe" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor disponible en http://localhost:${PORT}`);
});