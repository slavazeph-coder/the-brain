# Other open connectomes and brain atlases (besides the fruit fly) for the BrainSNN "Poke the Brain" toy

Research date: 2026-10-03. Method note: the sandbox egress proxy blocked most primary sites, including nature.com, alleninstitute.org, humanconnectome.org, surfer.nmr.mgh.harvard.edu, microns-explorer.org, zenodo.org, figshare.com, openworm.org, wormwiring.org and bigbrainproject.org. What I could check at the primary source: license files on raw.githubusercontent.com, the H01 release pages on storage.googleapis.com, the MICrONS public S3 bucket, the AWS Open Data Registry YAMLs, and actual data files in the `cect` wheel on PyPI, which I downloaded and measured myself. Everything else comes from web-search snippets of the primary pages and is marked "(search snippet)". Treat those as needing one more click-through before anything ships.

---

## 1. C. elegans: neuron/synapse counts, data formats and licenses, browser simulations, data size

### Takeaway
The worm is the strongest "real wiring you can poke" option. The whole hermaphrodite connectome (302 neurons; Cook et al. 2019) fits in about 17–31 KB of gzipped JSON. Several MIT or Apache-licensed browser simulations already show it can be done, and Witvliet 2021 adds 8 developmental snapshots, from birth to adult, of about 20–55 KB each. The weak point is the license on the underlying data: no explicit license for WormWiring or the Witvliet data turned up, so plan on attribution and, ideally, written permission.

### Cited Findings
**Counts**
- Cook et al. 2019 (Nature 571:63–71) whole-animal hermaphrodite graph: 460 nodes, made up of 302 neurons, 132 muscles and 26 non-muscle end organs. The male graph has 579 nodes: 385 neurons, 155 muscles and 39 end organs. — [ResearchGate abstract of Cook 2019](https://www.researchgate.net/publication/334212818_Whole-animal_connectomes_of_both_Caenorhabditis_elegans_sexes) (search snippet)
- A search summary credited "6,393 chemical synapses and 890 gap junctions" to the hermaphrodite connectome. — [IAS review](https://www.ias.ac.in/article/fulltext/jbsc/050/0016) (search snippet). **Flag:** I believe these figures come from Varshney et al. 2011 (279 somatic neurons), not Cook 2019. I could not verify this; do not quote them as Cook numbers.
- The wormlight project describes the adult hermaphrodite wiring it uses as "302 neurons, 3,709 chemical connections and 1,095 gap-junction pairs, with 956 connections onto 95 body-wall muscles … (Cook et al. 2019, as corrected in Emmons 2024)". — [chrisjz/wormlight README](https://github.com/chrisjz/wormlight)
- **My own count** of `herm_full_edgelist.csv` as shipped in OpenWorm's `cect` 0.3.5 wheel: 7,379 edge rows (4,681 chemical, 2,698 electrical; electrical edges are listed in both directions) across 448 named nodes. Of those, 300 are neurons; CANL/R have no synapses. The other 148 are muscles and end organs. Neuron-to-neuron rows only: 3,004 chemical and 1,708 electrical. — [cect on PyPI](https://pypi.org/project/cect/) (file `cect/data/herm_full_edgelist.csv`, 245 KB)
- Witvliet et al. 2021 (Nature 596) reconstructed the brains of 8 isogenic worms from birth to adulthood. Total synapse count rises about six-fold, "from about 1,300 at birth to approximately 8,000 in adulthood". The wiring scaffold is preserved, sensory and motor pathways remodel, and the brain becomes more feedforward and modular with age. — [bioRxiv preprint](https://www.biorxiv.org/content/10.1101/2020.04.30.066209v1.full.pdf); [Harvard MCB news](https://www.mcb.harvard.edu/department/news/zhen-samuel-and-lichtman-labs-generate-complete-synaptic-census-of-the-c-elegans-bra) (search snippet)
- **Stage breakdown conflict:** a search summary said "three L1, two L2, one L3, two adults". The files bundled in `cect` are named `witvliet_2020_1 L1` … `4 L1`, `5 L2`, `6 L3`, `7 adult`, `8 adult`, which is 4×L1, 1×L2, 1×L3 and 2×adult. I trust the filenames. — [cect on PyPI](https://pypi.org/project/cect/)
- **My own count of the Witvliet files** (pre, post, type, synapses columns):

  | Dataset | Cells | Chemical synapses | Gap-junction synapses |
  |---|---|---|---|
  | 1 (L1) | 187 | 1,296 | 104 |
  | 4 (L1) | 204 | 2,777 | 243 |
  | 5 (L2) | 211 | 4,116 | 419 |
  | 6 (L3) | 216 | 4,456 | 267 |
  | 7 (adult) | 222 | 7,467 | 400 |
  | 8 (adult) | 219 | 7,970 | 430 |

  Each xlsx file is 21–53 KB. — [cect on PyPI](https://pypi.org/project/cect/)

**Data formats and sizes**
- The `cect` wheel bundles 47 data files, about 13.6 MB in total. They include:
  - the Cook 2019 SI 5 adjacency matrices (about 4.2–4.4 MB xlsx, including a "corrected July 2020" version)
  - `herm_full_edgelist.csv` (245 KB)
  - White 1986 CSVs (40–67 KB)
  - the 8 Witvliet xlsx files
  - monoamine and neuropeptide connectome CSVs (about 185 KB each)
  - a NeuroML c302 network (`c302_C2_FW.net.nml`, 493 KB)

  — [cect on PyPI](https://pypi.org/project/cect/) (measured)
- **My size test:** the full Cook hermaphrodite edgelist as compact JSON is 247 KB raw and **30.6 KB gzip**. Neuron-to-neuron only, with indexed names, it is 63.5 KB raw and **16.9 KB gzip**. — computed from the [cect](https://pypi.org/project/cect/) file
- WormWiring hosts White 1986 through Cook 2019 data, including chemical and gap-junction connectivity between all neurons and end organs, with "connection weights … derived from number of synapses and synapse sizes". — [WormWiring](https://wormwiring.org/) (search snippet)
- OpenWorm's CElegansNeuroML repo holds per-neuron NeuroML cell files with 3D morphology. `ADAL.cell.nml` is 7.5 KB, so 302 neurons is about 2.3 MB raw; soma positions alone would be a few KB. — [openworm/CElegansNeuroML](https://github.com/openworm/CElegansNeuroML) (measured via raw.githubusercontent)

**Licenses**
- OpenWorm `c302` is MIT ("Copyright (c) 2024 OpenWorm"). — [c302 LICENSE](https://github.com/openworm/c302/blob/master/LICENSE)
- OpenWorm ConnectomeToolbox (`cect`) is MIT ("Copyright (c) 2026 OpenWorm"). — [ConnectomeToolbox LICENSE](https://github.com/openworm/ConnectomeToolbox/blob/main/LICENSE)
- I found no LICENSE file at the root of CElegansNeuroML. — [openworm/CElegansNeuroML](https://github.com/openworm/CElegansNeuroML) (LICENSE returns 404)
- The celegans-sim project (MIT) says outright: "The anatomical data is not mine and is not redistributed here". It downloads the raw anatomy (about 600 kB) from the original hosts, commits only a derived `celegans.json`, and asks users to cite White 1986, Chen/Hall/Chklovskii 2006, Cook 2019 and WormAtlas. — [YesterdaysLemon/celegans-sim](https://github.com/YesterdaysLemon/celegans-sim)
- WormWiring asks that its data be cited as Cook et al. 2019. No terms-of-use text was found. — [WormWiring](https://wormwiring.org/) (search snippet)

**Existing browser simulations**
- **heyseth/worm-sim**: an in-browser simulation where you click to place food. The connectome is drawn as dots, one per neuron. — [GitHub](https://github.com/heyseth/worm-sim). I found no LICENSE on main or master.
- **chrisjz/wormlight** (Apache-2.0): the full connectome runs on the GPU (WebGPU) and drives a physically simulated body. Neurons glow like calcium imaging, and you can lesion or restore neurons. It uses graded rather than spiking neurons ("as most of the worm's are"). Synapse signs are inferred: 46% from transmitter plus receptor expression, 38% from transmitter alone, and 14% have no basis. It is unusually candid that several behavioural checkpoints fail. — [GitHub](https://github.com/chrisjz/wormlight)
- **YesterdaysLemon/celegans-sim** (MIT, 2026): 302 graded-potential neurons, 95 body-wall muscles, compiled to WebAssembly, with a browser viewer. — [GitHub](https://github.com/YesterdaysLemon/celegans-sim)
- **OpenWorm**: c302 generates NeuroML 2 networks "at multiple levels of detail". OpenWorm also has a JS/WebGL 3D Worm Browser and a Geppetto-based web explorer. — [OpenWorm docs](https://docs.openworm.org/Projects/c302/); [Wikipedia: OpenWorm](https://en.wikipedia.org/wiki/OpenWorm) (search snippet)

### Inferences
- **Best honest feature:** a "Poke a real worm" mode that loads the Cook 2019 hermaphrodite wiring, about 17 KB gzipped for neurons only, lazily when the visitor opens the mode, so it stays out of the homepage bundle.
  - Lay neurons out from soma positions or with a force layout.
  - Run a simple graded or leaky-integrator model on that wiring.
  - Label it in place: **"Real wiring diagram (Cook et al. 2019). Simulated activity — not recorded neural data."**
- **"Watch it grow" slider:** Witvliet's 8 stages (about 187 to 222 cells, about 1.3k to 8k chemical synapses) would cost roughly 8 × 10–15 KB gzip after conversion to JSON (my estimate from the xlsx sizes). It is a uniquely honest "real data" story: the wiring is real, and only the activity is invented.
- Copy wormlight's honesty style: show where each synapse sign comes from, and say plainly that graded neurons and inferred signs are modelling choices.
- **Licensing posture.**
  - The code (c302/cect) is MIT.
  - The connectivity tables have no explicit license. Under US law bare factual data is generally not copyrightable, but EU database rights may apply. This is my inference, not legal advice.
  - Safest path: attribute Cook 2019 / Witvliet 2021 / WormWiring visibly, and email the Emmons and Zhen labs for permission.

### Gaps
- No explicit license was found for the WormWiring spreadsheets, the Cook 2019 supplementary tables or Witvliet/nemanode data. The Nature pages and wormwiring.org were blocked.
- I could not verify the exact Cook 2019 hermaphrodite totals (synapse counts) at the primary source. The Witvliet ages in hours were also not verified.
- No license for heyseth/worm-sim was found.

---

## 2. Human brain meshes and parcellations usable on a public, commercial-ish site

### Takeaway
**The cleanest find is the Allen Human Reference Atlas – 3D, 2020: 141 structures, CC BY 4.0 since 1 Sept 2022.** It is also packaged as a GLB by HuBMAP, and it covers all seven toy regions with commercial-friendly attribution terms.

- **fsaverage and Desikan-Killiany** (FreeSurfer license) are usable commercially, but they bring license-text and "mark modifications" obligations, and they have no cerebellum or subcortical surfaces.
- **MNI ICBM152 2009** carries a short permissive notice.
- **BigBrain** (non-commercial), **HCP-MMP** (HCP data use terms) and **BodyParts3D/Z-Anatomy** (share-alike) are riskier.

### Cited Findings
**Allen Human Reference Atlas – 3D, 2020**
- It is a 3D parcellation of the adult human brain that labels every voxel with one of 141 structures. Song-Lin Ding drew it on the ICBM 2009b Nonlinear Symmetric MRI template. "These materials are provided under the Attribution International 4.0 (CC BY 4.0) license as of Sept. 1, 2022." — [Allen community post](https://community.brain-map.org/t/allen-human-reference-atlas-3d-2020-new/405); [Allen README](https://download.alleninstitute.org/informatics-archive/allen_human_reference_atlas_3d_2020/version_1/README.pdf) (search snippet)
- The HuBMAP Human Reference Atlas made a 3D reference organ from it. It represents one hemisphere, mirrored "to arrive at a whole human brain and resized to fit the Visible Human Male and Female bodies". It is offered as GLB/FBX. The NIH 3D entry says that since v1.3 "this brain model is now licensed under … CC BY 4.0". — [NIH 3D entry 20960](https://3d.nih.gov/entries/20960); [HuBMAP 3D HRA paper](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11978508/) (search snippet)

**FreeSurfer license (covers fsaverage and the bundled Desikan-Killiany aparc atlas)**
- The license is "FreeSurfer Software License Agreement, Version 1.0 (February 2011)". It explicitly covers "software and/or data" downloaded from FreeSurfer. — [FreeSurfer LICENSE.txt on GitHub](https://raw.githubusercontent.com/freesurfer/freesurfer/dev/LICENSE.txt) (the canonical wiki page was blocked)
- **Grant:** "a royalty-free, non-exclusive license to use, reproduce, make derivative works of, display and distribute the Software". The conditions are:
  - all Part B terms "shall appear in and shall apply to such copy", with the prescribed preface "All or portions of this licensed product … have been obtained under license from The General Hospital Corporation 'MGH'…"
  - you preserve attributions
  - "modified versions … must be clearly identified and marked as such"

  — [FreeSurfer LICENSE.txt](https://raw.githubusercontent.com/freesurfer/freesurfer/dev/LICENSE.txt)
- **Commercial use is allowed.** The grant includes the right to "incorporate the Software into proprietary programs". "Any commercialization of the Software is at the sole risk of the party or parties engaged in such commercialization". The software is "for research purposes only" with no FDA review, and "clinical applications are neither recommended nor advised". MGH and funder names and logos may not be used for endorsement. — [FreeSurfer LICENSE.txt](https://raw.githubusercontent.com/freesurfer/freesurfer/dev/LICENSE.txt)
- TemplateFlow's fsaverage entry says "License: See LICENSE file", but the LICENSE file returns 404, so its license metadata is incomplete. — [tpl-fsaverage template_description.json](https://raw.githubusercontent.com/templateflow/tpl-fsaverage/master/template_description.json)

**Mesh sizes (measured)**
- nilearn ships fsaverage5 in-repo. `pial_left.gii.gz` is 200 KB, `infl_left` 200 KB and `sulc_left` 39 KB. — [nilearn fsaverage5 data](https://github.com/nilearn/nilearn/tree/main/nilearn/datasets/data/fsaverage5) (measured)
- **My own decode of fsaverage5 left pial:**
  - 10,242 vertices and 20,480 triangles per hemisphere
  - float32 positions plus uint16 indices: 245,784 bytes raw, 209,637 bytes gzip
  - 16-bit quantized positions: 184 KB raw, 158 KB gzip
  - so about 320–420 KB gzip for both hemispheres before any further decimation or meshopt/Draco compression

  — computed from the [nilearn fsaverage5 file](https://github.com/nilearn/nilearn/tree/main/nilearn/datasets/data/fsaverage5)

**MNI ICBM152 2009 template** (for a whole-brain silhouette via marching cubes)
- The license reads "Copyright (C) 1993–2004 Louis Collins, McConnell Brain Imaging Centre … Permission to use, copy, modify, and distribute this software and its documentation for any purpose and without fee is hereby granted, provided that the above copyright notice appear in all copies." — [TemplateFlow tpl-MNI152NLin2009cAsym LICENSE](https://raw.githubusercontent.com/templateflow/tpl-MNI152NLin2009cAsym/master/LICENSE)

**Desikan-Killiany-Tourville / Mindboggle-101**
- Mindboggle-101 is 101 manually labelled brains using the DKT protocol. Its data and surface/volume atlases are released "under a Creative Commons license", but the snippet did not say which variant. — [Klein & Tourville 2012, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3514540) (search snippet)

**HCP-MMP1.0 (Glasser 360-area)**
- Kathryn Mills projected it onto fsaverage and published it on figshare. Use is tied to the HCP terms, including acknowledging "the use of WU-Minn HCP data and data derived from WU-Minn HCP data when publicly presenting any results". — [figshare 3498446](https://figshare.com/articles/dataset/HCP-MMP1_0_projected_on_fsaverage/3498446/2); [MNE fetch_hcp_mmp_parcellation](https://mne.tools/1.0/generated/mne.datasets.fetch_hcp_mmp_parcellation.html) (search snippet)
- The HCP Open Access Data Use Terms (26 Apr 2013) are the stated license on the AWS registry entry. — [AWS registry hcp-openaccess.yaml](https://github.com/awslabs/open-data-registry/blob/main/datasets/hcp-openaccess.yaml) (verified)
- Item 4 of those terms: "I may redistribute original WU-Minn HCP Open Access data and any derived data as long as the data are redistributed under these same Data Use Terms." — [BALSA copy of the terms](https://balsa.wustl.edu/file/mplpX) (search snippet)
- **Conflict:** one search summary said "commercial use … is prohibited" under the HCP terms. A second search on the actual term text listed only items about re-identification, protected health information, redistribution under the same terms, and acknowledgment, with no commercial clause. — [BALSA](https://balsa.wustl.edu/file/mplpX). Treat this as unresolved.

**BigBrain** (one post-mortem brain of a 65-year-old donor at 20 µm; surfaces in MNI .obj, GIfTI and STL)
- Copies on neurodata.io are CC BY-NC 4.0. The project FTP states research use only, with no commercial use without written consent. — [neurodata.io BigBrain](https://neurodata.io/data/bigbrain); [BigBrain FTP Welcome.txt](https://ftp.bigbrainproject.org/bigbrain-ftp/Welcome.txt); [BigBrain maps & models](https://bigbrainproject.org/maps-and-models.html) (search snippets)

**BodyParts3D / Z-Anatomy**
- BodyParts3D is CC BY-SA 2.1 Japan (DBCLS). Z-Anatomy, which collects it, is CC BY-SA 4.0. A derived half-brain set has up to 89 meshes. — [SOURCES.txt of a BodyParts3D derivative](https://3d-anatomy-for-hn.duckdns.org/SOURCES.txt); [Interoperable Europe: Libre 3D atlas](https://interoperable-europe.ec.europa.eu/collection/fosseps/discussion/libre-3d-atlas-anatomy) (search snippets; weak secondary sources)

**BrainNet Viewer**
- It is a MATLAB toolbox, freely available on NITRC. Its `.nv` surfaces are ASCII vertex and triangle lists. No license found. — [Xia et al. 2013, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3701683) (search snippet)

### Inferences
- **Recommended mesh source: Allen Human Reference Atlas 3D 2020** (or the HuBMAP GLB derivative), attributed as CC BY 4.0. Its 141 structures should include all seven toy regions:
  - CTX: neocortex
  - HPC: hippocampal formation
  - THL: thalamus
  - AMY: amygdala
  - BG: caudate, putamen and pallidum
  - PFC: prefrontal or frontal cortex subdivisions
  - CBL: cerebellum

  Merge and decimate them to about 1–3k triangles per region. With quantization and meshopt this is plausibly about 100–250 KB for the whole set (my estimate, not measured). Lazy-load it so it does not land in the hero bundle; keep the procedural jelly as the instant first paint.
- **fsaverage is commercially usable but heavier on paperwork**: ship the FreeSurfer Part B text and mark the meshes as modified. It also only gives cortex, so you would still need subcortical and cerebellar meshes from elsewhere.
- **MNI ICBM152 2009** is the least-encumbered source for a single realistic outer brain silhouette.
- **Avoid for the homepage:** BigBrain (non-commercial), HCP-MMP (HCP terms carry over to any redistributed derived data, and the commercial status is ambiguous), and BodyParts3D/Z-Anatomy (share-alike could arguably reach the derived mesh asset).

### Gaps
- I did not see the HuBMAP brain GLB's file size, triangle count or structure list (the CDN was blocked). I also did not confirm that the Allen 3D download includes meshes and not just volumes.
- The exact Creative Commons variant for Mindboggle-101 is unknown.
- No license was found for BrainNet Viewer's bundled ICBM152 meshes.
- The HCP commercial-use question is unresolved: the primary PDF was blocked.
- Sketchfab CC0/CC-BY brain models were not surveyed.

---

## 3. Human structural connectivity to drive realistic pathways between the 7 regions

### Takeaway
Two compact options cover six of the seven regions:

- **ENIGMA Toolbox:** an HCP-derived group-average structural connectivity matrix over Desikan-Killiany-68 plus 14 subcortical regions. It is a 25 KB CSV with BSD-3 code, but the HCP data use terms still apply to the data.
- **Škoch et al. 2022:** 88 subjects, CC BY 4.0, not HCP-derived.

Neither is likely to include the cerebellum, so CBL pathways would need a textbook-based, clearly labelled hand specification. For curve geometry, Yeh's HCP-842/1065 tract atlases provide real bundle shapes.

### Cited Findings
**ENIGMA Toolbox**
- `load_sc()` returns HCP-derived group-average connectivity: "high-resolution structural connectivity data (derived from diffusion-weighted tractography) from a cohort of unrelated healthy adults from the Human Connectome Project". It covers Desikan-Killiany, Glasser and Schaefer 100–400 parcellations. `load_sc_as_one()` adds 14 subcortical regions. — [ENIGMA docs: Connectivity data](https://enigma-toolbox.readthedocs.io/en/latest/pages/05.HCP/index.html) (search snippet); [ENIGMA base.py](https://github.com/MICA-MNI/ENIGMA/blob/master/enigmatoolbox/datasets/base.py) (verified)
- `strucMatrix_with_sctx.csv` is 25,098 bytes. Its labels are the 68 DK cortical parcels plus Laccumb, Lamyg, Lcaud, Lhippo, Lpal, Lput, Lthal and the right-hemisphere equivalents. That covers CTX, PFC (frontal DK parcels), HPC, AMY, THL and BG, but not cerebellum. — [ENIGMA repo, measured](https://github.com/MICA-MNI/ENIGMA/tree/master/enigmatoolbox/datasets/matrices/hcp_connectivity)
- The ENIGMA code is BSD 3-Clause ("Copyright (c) 2020, saratheriver"). — [ENIGMA LICENSE](https://github.com/MICA-MNI/ENIGMA/blob/master/LICENSE)

**Škoch et al. 2022 (Scientific Data)**
- Structural connectivity matrices from 88 healthy subjects using probabilistic tractography, together with the raw diffusion data. Available on OSF and Zenodo under CC BY 4.0. — [PMC9363436](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9363436/); [Zenodo 6770120](https://zenodo.org/record/6770120) (search snippet). The parcellation is reportedly AAL-based (not verified in text).

**Lausanne (Griffa, Alemán-Gómez, Hagmann)**
- "Structural and functional connectome from 70 young healthy adults" (Zenodo, 16 May 2019). Multi-scale Lausanne parcellations of 129, 234, 463 and 1015 regions. — [Zenodo 2872624](https://zenodo.org/record/2872624) (search snippet; license not shown)

**Yeh tract atlases (real pathway geometry)**
- The HCP-842/1065 population-averaged tractography atlas was described as "licensed under a CC-BY 4.0 International license". That may be the bioRxiv preprint's license rather than the data's. The NIfTI atlas is on Zenodo, and "Atlas of 30 Human Brain Bundles in MNI space" (trk files, 214.86 MB) is on figshare. — [Yeh et al. bioRxiv](https://www.biorxiv.org/content/10.1101/136473v1.full.pdf); [Zenodo 3627772](https://zenodo.org/records/3627772); [figshare 12089652](https://figshare.com/articles/dataset/Atlas_of_30_Human_Brain_Bundles_in_MNI_space/12089652) (search snippets)
- The HCP terms require redistributed derived data to carry the same terms, and require acknowledgment. — [BALSA copy of the terms](https://balsa.wustl.edu/file/mplpX) (search snippet)

### Inferences
- **Practical recipe:** aggregate ENIGMA's DK+subcortical matrix, or Škoch's CC BY matrix, into a 7×7 weight table. Use it to set which pathways exist and how thick or bright they are. For cerebellum, specify textbook routes by hand (cortico-ponto-cerebellar, cerebello-thalamo-cortical) and mark them in the code and copy as "schematic".
- A 7×7 table is about 49 numbers, which is effectively zero bundle cost.
- **Licensing:**
  - The ENIGMA matrix is HCP-derived. Shipping even an aggregated table probably triggers the HCP acknowledgment and same-terms clause. Prefer Škoch (CC BY 4.0) if the commercial question matters, or include the HCP acknowledgment.
  - For curved pathway shapes, decimate a handful of centroid streamlines per bundle from Yeh's atlas (a few KB as Catmull-Rom control points). Verify the data license first, since it is HCP-derived.
- **Honest copy:** "Pathway layout inspired by population-average diffusion-MRI tractography (citation). Signals shown are simulated."

### Gaps
- I did not confirm the licenses for Lausanne Zenodo 2872624 or for Yeh's atlas data (as opposed to the preprint).
- I did not verify whether Škoch's matrices include cerebellar regions.
- The HCP commercial-use clause is unresolved (see Section 2).

---

## 4. MICrONS, H01 and Allen: what is realistic for a toy, licenses, sizes

### Takeaway
MICrONS and H01 are both CC BY 4.0. H01 is verified at its primary release page; MICrONS is from search snippets. Both are petabyte-scale, so the realistic toy use is one or a few exemplar real neurons (SWC skeletons of a few KB, or decimated meshes) as a "zoom into a real neuron" moment.

Allen Institute content defaults to **research or noncommercial** use under its Terms of Use. That makes the mouse CCF meshes and most Allen atlases risky for brainsnn.com. The exceptions are explicitly CC BY datasets: the Human Reference Atlas 3D and AIND data.

### Cited Findings
**MICrONS (mouse visual cortex, cubic millimetre)**
- Published as a Nature package in April 2025. It spans about 1 mm³ of mouse visual cortex with about 200,000 cells, about 75,000 neurons with physiology, and 523 million synapses, across all 6 layers of V1 and 3 higher visual areas. — [MICrONS Explorer cortical-mm3](https://www.microns-explorer.org/cortical-mm3) (search snippet); [Nature s41586-025-08790-w](https://www.nature.com/articles/s41586-025-08790-w)
- Nature Methods named EM-based connectomics its Method of the Year 2025. — [Nature Methods](https://www.nature.com/articles/s41592-025-02988-6) (search snippet)
- **License:** "All reconstruction files, as well as the file manifest and cell metadata downloads, are subject to CC 4.0", and the MICrONS Explorer portal is under CC BY 4.0. — [Allen portal: ultrastructural connectomics](https://portal.brain-map.org/connectivity/ultrastructural-connectomics); [MICrONS Explorer data](https://www.microns-explorer.org/data) (search snippets)
- The BossDB registry lists per-dataset licenses as "CC BY 4.0; CC0 1.0; CC BY-NC-SA 4.0", so check each dataset. — [AWS registry bossdb.yaml](https://github.com/awslabs/open-data-registry/blob/main/datasets/bossdb.yaml) (verified)
- **Measured on the public S3 bucket** `bossdb-open-data/iarpa_microns/minnie/minnie65/`:
  - `skeletons/v661/skeletons/*.swc` files range from 181 B to 6.3 KB in the first listings
  - `meshworks/*.h5` files are about 110 KB to 1.15 MB
  - `cell_types/allen_soma_ei_class_model_v1.csv` is 4.4 MB
  - `synapse_graph/synapses_pni_2.csv` is **51 GB**

  — [BossDB S3 listing](https://bossdb-open-data.s3.amazonaws.com/?prefix=iarpa_microns/minnie/minnie65/&delimiter=/)

**H01 (human temporal cortex fragment)**
- The release page describes "a 1.4 petabyte volume of a small sample of human brain tissue" (about 1 mm³), "tens of thousands of reconstructed neurons, millions of neuron fragments, 183 million annotated synapses, 100 proofread cells". — [H01 release landing page](https://h01-release.storage.googleapis.com/landing.html) (verified)
- Data products: 4 nm EM; C2 and C3 segmentations; meshes and skeletons for all segmentations; "104 manually proofread cells with SWC format skeletons"; 50,000 cell-body locations; Avro synapse tables; E/I synapse annotations. **"All released datasets are licensed under a Creative Commons Attribution 4.0 License."** — [H01 release data page](https://h01-release.storage.googleapis.com/data.html) (verified)
- Paper: Shapson-Coe et al., Science 384, eadk4858 (2024), with 57,000 cells and 150 million synapses. The sample was removed surgically to reach an epileptic focus, and glia outnumber neurons 2:1. — [Google Research publication page](https://research.google/pubs/a-connectomic-study-of-a-petascale-fragment-of-human-cerebral-cortex/) (search snippet). **Note:** the paper's 150M synapses versus the release page's 183M "annotated synapses" probably reflects different counting or versions.

**Allen Institute terms**
- Use of Allen content, including derivative works, "must be for research or other noncommercial purposes unless it is otherwise stated in the Terms or agreed to in writing". A limited set may appear in scholarly, journalistic or educational publications with citation. — [Allen Terms of Use](https://alleninstitute.org/legal/terms-of-use); [Allen Citation Policy](https://alleninstitute.org/legal/citation-policy) (search snippets)
- License fields in the AWS registry (verified):
  - Allen Mouse Brain Atlas: Allen Terms of Use — [allen-mouse-brain-atlas.yaml](https://github.com/awslabs/open-data-registry/blob/main/datasets/allen-mouse-brain-atlas.yaml)
  - Allen Brain Observatory: Allen Terms of Use — [allen-brain-observatory.yaml](https://github.com/awslabs/open-data-registry/blob/main/datasets/allen-brain-observatory.yaml)
  - Allen Institute for Neural Dynamics data: **CC-BY-4.0** — [allen-nd-open-data.yaml](https://github.com/awslabs/open-data-registry/blob/main/datasets/allen-nd-open-data.yaml)
- **Allen Mouse CCFv3:** 43 isocortical areas and their layers, 329 subcortical grey-matter structures, 81 fibre tracts and 8 ventricular structures. It is "openly accessible for research use under the Allen Institute's Terms of Use". brainglobe-atlasapi serves the region meshes as OBJ. — [Wang et al. 2020, PubMed](https://pubmed.ncbi.nlm.nih.gov/32386544/); [brainglobe-atlasapi on PyPI](https://pypi.org/project/brainglobe-atlasapi/2.0.3); [Allen community: CCF](https://community.brain-map.org/t/allen-mouse-ccf-accessing-and-using-related-data-and-tools/) (search snippets)
- **Janelia MouseLight** single-neuron reconstructions are CC BY-NC 4.0. — [MouseLight Neuron Browser on figshare](https://janelia.figshare.com/collections/MouseLight_Neuron_Browser/3924067) (search snippet)

### Inferences
- **Toy-scale ideas:**
  - A "this is what one real neuron looks like" inset: one H01 proofread human pyramidal-cell SWC (CC BY 4.0, verified), or one MICrONS cell, rendered as glowing tubes, a few to tens of KB.
  - A tiny "1 mm³ of real cortex" point cloud of soma positions. MICrONS cell-type CSVs are a few MB, so subsample to about 2–5k points, roughly 20–40 KB.
  - Keep the copy factual: "Real reconstructed shape (H01, Shapson-Coe et al. 2024, CC BY 4.0). Activity is simulated."
- **Do not use Allen CCF or MouseLight meshes on a commercial-ish site** without written permission from Allen or Janelia (noncommercial terms).
- A mouse brain is also off-message for a human seven-region toy.

### Gaps
- I did not check the MICrONS license text at its primary page (blocked), or the current MICrONS public release version and proofread-neuron counts.
- No typical size was measured for a single full-neuron decimated mesh from H01 or MICrONS. The SWCs I listed in MICrONS v661 were mostly small fragments.
- I did not see Allen's position on displaying CCF meshes on a commercial website.

---

## 5. Zebrafish and mouse whole-brain resources released by 2026 that are browser-friendly

### Takeaway
2025–2026 brought several larval zebrafish whole-brain EM resources (Fish-X, Fish1/Petkova 2025, FishExplorer), and an independent WebGPU viewer already renders Fish1 in the browser. The first complete vertebrate connectome, Janelia/Google/Harvard "Fish Fire&Wire" (about 140k neurons), reached draft in 2026 but is still being proofread. The licenses that are visible are non-commercial (Fish1 preprint CC BY-NC; mapZebrain CC BY-NC).

Whole-mouse-brain EM connectomics is still at the 1–10 mm³ stage (MICrONS, MouseConnects hippocampus). Nothing is browser-ready at whole-brain scale.

### Cited Findings
**Zebrafish**
- **Fish-X** (bioRxiv, June 2025) is a synapse-level, neuromodulatory-type-annotated EM reconstruction of a 6 dpf larval zebrafish brain, from retina to anterior spinal cord. — [bioRxiv 2025.06.12.659365](https://www.biorxiv.org/content/10.1101/2025.06.12.659365v2.full) (search snippet)
- **Fish1 / Petkova, Januszewski et al. 2025** is a 7 dpf CLEM dataset with more than 180,000 segmented soma, more than 40,000 molecularly annotated neurons and 30 million synapses, on an open-access CAVE/Neuroglancer platform. "The preprint is made available under a CC-BY-NC 4.0 International license." That is the preprint's license; the data license is not stated. — [bioRxiv 2025.06.10.658982](https://www.biorxiv.org/content/10.1101/2025.06.10.658982v1); [Google Research publication page](https://research.google/pubs/a-connectomic-resource-for-neural-cataloguing-and-circuit-dissection-of-the-larval-zebrafish-brain/) (search snippets)
- **FishExplorer** (ZIB) is a multimodal atlas platform built on the about 180k-soma, about 30M-synapse EM dataset. — [bioRxiv 2025.07.14.664689](https://www.biorxiv.org/content/10.1101/2025.07.14.664689v1.full) (search snippet)
- **CPSv1.0** is a common physical space with a projectome of 12,219 excitatory and 7,792 inhibitory single-neuron morphologies (June 2025). — [bioRxiv 2025.06.06.658008](https://www.biorxiv.org/content/10.1101/2025.06.06.658008v1) (search snippet)
- **jamieswrld/zebrafishconnectome** is a WebGPU viewer built on Fish1.
  - It renders about 200k soma in 2 draw calls.
  - Its default dataset is 30,346 soma from the published Fish1 analysis packages; full Fish1 access needs a CAVE token.
  - It includes a hindbrain motion-integrator circuit of 865 cells and 1,235 traced synaptic pairs.
  - Every number is labelled measured, derived or synthetic, and synthetic data is badged "NOT BIOLOGICAL DATA".
  - It notes that "mapZebrain is CC-BY-NC and brain-only".

  — [GitHub README](https://github.com/jamieswrld/zebrafishconnectome)
- The Fish1 hindbrain CLEM analysis code is MIT. Data are reached via a Neuroglancer link that requires a Google login. — [jboulanger91/Zebrafish_CLEM](https://github.com/jboulanger91/Zebrafish_CLEM)
- Earlier work: Svara et al. 2022, automated synapse-level reconstruction of larval zebrafish circuits. — [Nature Methods](https://www.nature.com/articles/s41592-022-01621-0)
- **Fish Fire&Wire** (Janelia, Harvard and Google): a whole-brain larval zebrafish connectome of "roughly 140,000 neurons, every synapse traced", with the draft completed in 2026 and proofreading ongoing. It will be paired with ZAPBench, a whole-brain light-sheet activity recording of about 70,000 neurons from the same fish (released March/April 2025). — [Janelia Fish Fire&Wire](https://www.janelia.org/fish-firewire); [Google Research ZAPBench blog](https://research.google/blog/improving-brain-models-with-zapbench/); [Google neural-mapping datasets page](https://sites.research.google/gr/neural-mapping/datasets/) (search snippets)
- A 2026 paper on LC-NE input organization from a multiplexed whole-brain EM reconstruction (Chinese Academy of Sciences authors) was reported. — (search snippet; [bioRxiv Fish-X PDF](https://www.biorxiv.org/content/10.1101/2025.06.12.659365.full.pdf))

**Mouse**
- NIH BRAIN CONNECTS ($150M, 11 projects, launched 2023) funds:
  - **MouseConnects**, a $33M Harvard-led effort with Google and others, targeting 10 mm³ of mouse hippocampus. Reportedly hit by NIH funding changes in early 2025.
  - An **Allen Institute project** imaging up to 10 mm³ of the cortico-basal ganglia-thalamo-cortical loop.

  — [NeuroTrailblazers: MouseConnects](https://www.neurotrailblazers.org/datasets/workflow/); [Allen news](https://alleninstitute.org/news/projects-launch-to-map-brain-connections-in-mouse-and-macaque); [Google Research blog](https://research.google/blog/google-research-embarks-on-effort-to-map-a-mouse-brain/) (search snippets)
- As of the searches, MICrONS (April 2025) remains the headline mouse EM connectome milestone. — [Live Science](https://www.livescience.com/health/neuroscience/scientists-built-largest-brain-connectome-to-date-by-having-a-lab-mouse-watch-the-matrix-and-star-wars); [State of Brain Emulation Report 2025](https://arxiv.org/pdf/2510.15745) (search snippets)

### Inferences
- **Zebrafish is the most exciting 2026 story** ("first vertebrate whole-brain connectome"), but it is not shippable on brainsnn.com yet:
  - Fire&Wire is a draft with no confirmed public license.
  - Fish1's visible licensing is non-commercial.
  - mapZebrain is CC BY-NC.

  Revisit once Fire&Wire publishes its data terms. A small "real zebrafish wiring" mode built from a published circuit export would then be feasible; the jamieswrld viewer shows the browser side works.
- For mouse, there is nothing at whole-brain synaptic scale. Allen mesoscale atlases are noncommercial. MICrONS (CC BY 4.0) is the only commercially friendly real mouse EM data, best used as a single-neuron or "1 mm³" vignette.
- **Overall priority for BrainSNN** (my synthesis):
  1. C. elegans "real wiring, simulated activity" mode: tiny, MIT-licensed tooling, strong story.
  2. Allen Human Reference Atlas 3D (CC BY 4.0) region meshes for the seven regions, lazy-loaded.
  3. A 7×7 pathway-weight table from Škoch (CC BY 4.0) or ENIGMA (HCP terms).
  4. One H01 real human neuron (CC BY 4.0) as an easter egg.

### Gaps
- Fire&Wire's public data release status, format, size and license as of October 2026 were not verified; the Janelia and Google pages were blocked.
- The Fish-X data license and access requirements are unknown.
- I found no evidence of a whole-mouse-brain synaptic connectome release by October 2026. Absence of evidence is not proof, since the searches were snippet-only.
