# MédicaMente

Generador de cuestionarios médicos desde uno o varios PDFs, con análisis de contenido y auditoría de preguntas mediante OpenAI.

## Configuración local

1. Copia `.env.example` como `.env`.
2. Abre `.env` y coloca tu API key en `OPENAI_API_KEY`.
3. Ejecuta `npm start` dentro de esta carpeta.
4. Abre `http://localhost:3000`.

La API key permanece en el servidor y `.env` está excluido de GitHub. No abras `index.html` mediante `file:///`, porque el navegador no puede acceder al backend de esa forma.

## Flujo de generación

1. Extrae el texto y la página de cada PDF en el navegador.
2. El backend identifica conocimiento examinable.
3. Genera casos clínicos o preguntas conceptuales según la evidencia disponible.
4. Audita cada pregunta para evitar respuestas expuestas, ambigüedades y distractores deficientes.

