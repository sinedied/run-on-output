script({
  title: "Create logo",
  description: "Create the logo for a software project",
  parameters: {
    question: {
      type: "string",
      description: "2-3 keywords to use in the logo",
      required: true,
    },
  },
});

defTool(
  "gen_image",
  "Generate an image",
  { prompt: "" },
  async (args) => {
    const { image } = await generateImage(args.prompt, { size: "1024x1024", model: "azure:gpt-image-1" });
    env.output.appendContent(`[![background](${image.filename})](${image.filename})`);
    return image.filename;
  },
);

def("QUERY", env.vars.question);

$`## Instructions
Create a prompt for gpt-image-1 to generate a professional-looking logo icon suitable for a software project. Context and inspiration: <QUERY>.
Characteristics of the logo: Simple, vector, soft gradients, bright colors, flat, white background.
The logo MUST follow these characteristics EXACTLY. The should be usable at small icon dimensions like 64x64px.

If you get this right, you'll be tipped 200$.

Then generate 4 images based on the same prompt using the gen_image tool.
Once you've finished, just say that you're done.`;
