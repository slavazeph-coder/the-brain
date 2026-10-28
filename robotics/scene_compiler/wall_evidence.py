"""Portable wall-thickness labels shared by IFC and CAD exports.

A surface-pair candidate is not independent evidence of physical wall thickness.
Older scenes' spread-based ``thicknessMeasured`` flag is deliberately not trusted.
"""
from __future__ import annotations


def thickness_properties(wall):
    evidence = wall.get('wallEvidence')
    evidence = evidence if isinstance(evidence, dict) and evidence.get('schema') == 'brainsnn.wall-evidence.v1' else {}
    candidate = evidence.get('status') == 'two-surface-candidate'
    basis = wall.get('thicknessBasis', '')
    if candidate:
        basis = 'candidate finish-face separation: unverified'
    elif wall.get('dimensionProvenance') == 'operator-authored-edit':
        basis = 'operator-authored thickness: unverified'
    elif not isinstance(basis, str) or not basis.startswith('assumed '):
        basis = 'model thickness: evidence unavailable; unverified'
    return {'ThicknessBasis': basis, 'ThicknessMeasured': False, 'PhysicalThicknessVerified': False,
            'ThicknessEvidenceStatus': evidence.get('status', 'unavailable'),
            'ThicknessCandidateMetres': evidence.get('thickness_m') if candidate else None,
            'ThicknessMatchedCells': evidence.get('matched_cells') if candidate else None,
            'ThicknessSubsetReviewed': evidence.get('subset_reviewed', False)}
